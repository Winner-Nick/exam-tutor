import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { useToast } from './Toast'
import type { ChatMessage, Question } from '../types'

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
  const qc = useQueryClient()
  const toast = useToast()
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const chat = useQuery({
    queryKey: ['chat', jobId, qid],
    queryFn: () => api.getChat(jobId, qid),
  })

  const ask = useMutation({
    mutationFn: (text: string) => api.ask(jobId, text, qid),
    onMutate: async (text) => {
      // 立即上屏用户消息
      qc.setQueryData<{ messages: ChatMessage[] }>(['chat', jobId, qid], (old) => ({
        messages: [...(old?.messages ?? []), { role: 'user', content: text }],
      }))
    },
    onSuccess: ({ answer }) => {
      qc.setQueryData<{ messages: ChatMessage[] }>(['chat', jobId, qid], (old) => ({
        messages: [...(old?.messages ?? []), { role: 'assistant', content: answer }],
      }))
    },
    onError: (e) => {
      toast(e instanceof ApiError ? e.message : '提问失败，请重试', 'error')
      qc.invalidateQueries({ queryKey: ['chat', jobId, qid] })
    },
  })

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat.data?.messages.length, ask.isPending])

  function submit() {
    const text = input.trim()
    if (!text || ask.isPending) return
    setInput('')
    ask.mutate(text)
  }

  const messages = chat.data?.messages ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line pb-2.5">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Icon name="robot" size={17} className="text-primary-600 dark:text-primary-400" />
          AI 家教
        </span>
        {question ? (
          <button
            onClick={onClearFocus}
            title="切回整卷答疑"
            className="badge bg-primary-50 text-primary-700 transition-colors hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300"
          >
            第 {question.number} 题 <Icon name="x" size={11} />
          </button>
        ) : (
          <span className="badge bg-surface-2 text-dim">整卷答疑</span>
        )}
      </div>

      <div ref={listRef} className="thin-scroll flex-1 space-y-3 overflow-y-auto py-3">
        {messages.length === 0 && !ask.isPending && (
          <div className="space-y-3 py-6 text-center text-xs text-dim">
            <Icon name="chat" size={26} className="mx-auto" />
            <p>{question ? '问问这道题哪里不懂吧' : '可以问整张试卷的任何问题'}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {(question
                ? ['这道题为什么选这个答案？', '有什么类似的题吗？']
                : ['这次考试哪些知识点掌握得不好？', '帮我总结一下错题规律']
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s)
                  }}
                  className="rounded-full border border-line px-2.5 py-1 text-ink2 transition-colors hover:border-primary-300 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 ${
                m.role === 'user'
                  ? 'rounded-br-sm bg-primary-600 text-white'
                  : 'rounded-bl-sm bg-surface-2'
              }`}
            >
              {m.role === 'user' ? (
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              ) : (
                <Markdown text={m.content} />
              )}
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div className="flex items-center gap-2 text-xs text-dim">
            <span className="flex gap-1">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
            </span>
            AI 家教思考中…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-line pt-2.5">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={question ? `针对第 ${question.number} 题提问…` : '输入问题…'}
          className="input thin-scroll max-h-28 flex-1 resize-none"
        />
        <button
          onClick={submit}
          disabled={!input.trim() || ask.isPending}
          className="btn-primary px-3.5 py-2"
          title="发送"
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  )
}
