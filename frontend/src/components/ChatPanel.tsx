import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { ChatMessage, Question } from '../types'
import { mergeChatMessages } from '../utils/chatHistory'
import { ErrorState } from './ErrorState'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

const CHAT_PAGE_SIZE = 50

interface ChatCache {
  messages: ChatMessage[]
  hasMore: boolean
}

interface AskVariables {
  jobId: string
  qid: string | null
  text: string
  optimisticId: string
}

export function ChatPanel({
  jobId,
  question,
  onClearFocus,
}: {
  jobId: string
  question: Question | null
  onClearFocus: () => void
}) {
  const qid = question?.id ?? null
  const scope = `${jobId}:${qid ?? 'paper'}`
  const qc = useQueryClient()
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loadingOlder, setLoadingOlder] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const inFlight = useRef(false)
  const nextOptimisticId = useRef(0)
  const olderController = useRef<AbortController | null>(null)
  const historyGeneration = useRef(0)
  const preserveScroll = useRef(false)
  const input = drafts[scope] ?? ''

  const chat = useQuery<ChatCache>({
    queryKey: ['chat', jobId, qid],
    queryFn: async ({ signal }) => {
      const page = await api.getChat(jobId, qid, { signal, limit: CHAT_PAGE_SIZE })
      return { messages: page.messages, hasMore: page.has_more }
    },
  })

  const ask = useMutation({
    mutationFn: (variables: AskVariables) => api.ask(variables.jobId, variables.text, variables.qid),
    onMutate: async (variables) => {
      const key = ['chat', variables.jobId, variables.qid]
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<ChatCache>(key, (old) => ({
        messages: [...(old?.messages ?? []), { id: variables.optimisticId, role: 'user', content: variables.text }],
        hasMore: old?.hasMore ?? false,
      }))
    },
    onSuccess: ({ answer }, variables) => {
      qc.setQueryData<ChatCache>(['chat', variables.jobId, variables.qid], (old) => ({
        messages: [...(old?.messages ?? []), { id: `${variables.optimisticId}:answer`, role: 'assistant', content: answer }],
        hasMore: old?.hasMore ?? false,
      }))
    },
    onError: (error, variables) => {
      qc.setQueryData<ChatCache>(['chat', variables.jobId, variables.qid], (old) => old ? {
        ...old,
        messages: old.messages.filter((message) => message.id !== variables.optimisticId),
      } : old)
      const failedScope = `${variables.jobId}:${variables.qid ?? 'paper'}`
      setDrafts((old) => ({ ...old, [failedScope]: old[failedScope] || variables.text }))
      toast(error instanceof ApiError ? error.message : '提问失败，请检查网络后重试', 'error')
    },
    onSettled: () => {
      inFlight.current = false
    },
  })

  const currentPending = ask.isPending && ask.variables?.jobId === jobId && ask.variables.qid === qid
  const otherScopePending = ask.isPending && !currentPending
  const currentError = ask.isError && ask.variables?.jobId === jobId && ask.variables.qid === qid ? ask.error : null
  const currentSuccess = ask.isSuccess && ask.variables?.jobId === jobId && ask.variables.qid === qid

  useEffect(() => {
    historyGeneration.current += 1
    olderController.current?.abort()
    olderController.current = null
    setLoadingOlder(false)
  }, [scope])
  useEffect(() => () => olderController.current?.abort(), [])

  useEffect(() => {
    if (preserveScroll.current) {
      preserveScroll.current = false
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [chat.data?.messages.length, currentPending, qid, jobId])

  function setInput(value: string) {
    setDrafts((old) => ({ ...old, [scope]: value }))
  }

  function send(variables: AskVariables) {
    if (inFlight.current || ask.isPending) return
    inFlight.current = true
    ask.mutate(variables)
  }

  function submit() {
    const text = input.trim()
    if (!text || inFlight.current || ask.isPending || composing.current) return
    setInput('')
    nextOptimisticId.current += 1
    send({ jobId, qid, text, optimisticId: `chat-temp-${Date.now()}-${nextOptimisticId.current}` })
  }

  const messages = chat.data?.messages ?? []
  const hasMore = chat.data?.hasMore ?? false
  const beforeId = messages.find((message) => typeof message.id === 'number')?.id as number | undefined

  async function loadOlder() {
    if (!hasMore || beforeId == null || olderController.current) return
    const controller = new AbortController()
    const generation = historyGeneration.current
    olderController.current = controller
    setLoadingOlder(true)
    try {
      const page = await api.getChat(jobId, qid, { limit: CHAT_PAGE_SIZE, beforeId, signal: controller.signal })
      if (generation !== historyGeneration.current) return
      preserveScroll.current = true
      qc.setQueryData<ChatCache>(['chat', jobId, qid], (old) => ({
        messages: mergeChatMessages(old?.messages ?? [], page.messages),
        hasMore: page.has_more ?? false,
      }))
    } catch (error) {
      if (generation === historyGeneration.current && !(error instanceof ApiError && error.code === 'abort')) {
        toast(error instanceof ApiError ? error.message : '加载更早消息失败，请重试', 'error')
      }
    } finally {
      if (generation === historyGeneration.current) {
        olderController.current = null
        setLoadingOlder(false)
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line pb-2.5">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Icon name="robot" size={17} className="text-primary-600 dark:text-primary-400" /> AI 家教
        </span>
        {question ? (
          <button onClick={onClearFocus} className="badge min-h-8 bg-primary-50 text-primary-800 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-200">
            第 {question.number} 题 <Icon name="x" size={11} />
            <span className="sr-only">，切回整卷答疑</span>
          </button>
        ) : (
          <span className="badge bg-surface-2 text-ink2">整卷答疑</span>
        )}
      </div>

      <div ref={listRef} className="thin-scroll flex-1 space-y-3 overflow-y-auto py-3" aria-busy={chat.isPending || currentPending || loadingOlder}>
        {chat.isPending ? (
          <div className="flex h-full min-h-32 items-center justify-center gap-2 text-sm text-ink2">
            <Spinner /> 正在加载这段对话…
          </div>
        ) : chat.isError ? (
          <ErrorState error={chat.error} compact title="对话加载失败" onRetry={() => void chat.refetch()} />
        ) : (
          <>
            {hasMore && <div className="text-center"><button disabled={beforeId == null || loadingOlder} onClick={() => void loadOlder()} className="btn-outline px-3 py-1.5 text-xs">{loadingOlder ? '正在加载更早消息…' : '加载更早消息'}</button></div>}
            {messages.length === 0 && !currentPending && (
              <div className="space-y-3 py-6 text-center text-xs text-ink2">
                <Icon name="chat" size={26} className="mx-auto text-dim" />
                <p>{question ? '问问这道题哪里不懂吧' : '可以问整张试卷的任何问题'}</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {(question
                    ? ['这道题为什么选这个答案？', '有什么类似的题吗？']
                    : ['这次考试哪些知识点掌握得不好？', '帮我总结一下错题规律']
                  ).map((suggestion) => (
                    <button key={suggestion} onClick={() => setInput(suggestion)} className="min-h-11 rounded-full border border-line px-3 py-1 text-ink2 hover:border-primary-300 hover:text-primary-700 dark:hover:text-primary-300">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={message.id ?? `${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 ${message.role === 'user' ? 'rounded-br-sm bg-primary-700 text-white' : 'rounded-bl-sm bg-surface-2'}`}>
                  {message.role === 'user' ? <p className="text-sm whitespace-pre-wrap">{message.content}</p> : <Markdown text={message.content} />}
                </div>
              </div>
            ))}
          </>
        )}
        {currentPending && (
          <div className="flex items-center gap-2 text-xs text-ink2" role="status">
            <span className="flex gap-1" aria-hidden>
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
            </span>
            AI 家教思考中…
          </div>
        )}
        {otherScopePending && <p className="text-xs text-ink2" role="status">另一段对话正在回答，完成后可继续提问。</p>}
        {currentError && (
          <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200" role="alert">
            <p>{currentError instanceof ApiError ? currentError.message : '提问失败，请重试'}</p>
            <button className="btn-outline mt-2 px-3" onClick={() => ask.variables && send(ask.variables)}>重试这次提问</button>
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-line pt-2.5">
        <label className="sr-only" htmlFor={`chat-input-${scope}`}>输入答疑问题</label>
        <textarea
          id={`chat-input-${scope}`}
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={question ? `针对第 ${question.number} 题提问…` : '输入问题…'}
          className="input thin-scroll max-h-28 flex-1 resize-none"
        />
        <button onClick={submit} disabled={!input.trim() || ask.isPending} className="btn-primary h-11 w-11" aria-label="发送问题">
          <Icon name="send" size={16} />
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{currentPending ? '正在等待 AI 回答' : currentSuccess ? '回答已收到' : ''}</p>
    </div>
  )
}
