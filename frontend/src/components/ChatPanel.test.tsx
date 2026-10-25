import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { api, ApiError } from '../api'
import type { ChatMessage, Question } from '../types'
import { ChatPanel } from './ChatPanel'

type CachedMessage = ChatMessage & { id?: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function question(id: string): Question {
  return {
    id, number: id, section: null, type: '单选', stem: '题干', options: null, passage: null,
    student_answer: null, correct_answer: 'A', status: 'wrong', knowledge_point: null,
    explanation: null, explain_state: 'none', revision: 1,
  }
}

function setup(qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  qc.setQueryData(['chat', 'job', 'q1'], { messages: [{ role: 'assistant', content: '旧内容' }] })
  qc.setQueryData(['chat', 'job', null], { messages: [] })
  vi.spyOn(api, 'getChat').mockImplementation(async () => ({ messages: [] }))
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const view = render(<ChatPanel jobId="job" question={question('q1')} onClearFocus={() => undefined} />, { wrapper })
  return { qc, view }
}

function cache(qc: QueryClient, qid: string | null) {
  return qc.getQueryData<{ messages: CachedMessage[] }>(['chat', 'job', qid])?.messages ?? []
}

it('blocks cross-scope overlap and applies a late answer to its original scope', async () => {
  const pending = deferred<{ answer: string }>()
  const ask = vi.spyOn(api, 'ask').mockReturnValue(pending.promise)
  const { qc, view } = setup()
  fireEvent.change(screen.getByLabelText('输入答疑问题'), { target: { value: '第一个问题' } })
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }))
  await waitFor(() => expect(ask).toHaveBeenCalledOnce())

  view.rerender(<ChatPanel jobId="job" question={null} onClearFocus={() => undefined} />)
  fireEvent.change(screen.getByLabelText('输入答疑问题'), { target: { value: '另一个范围的问题' } })
  expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }))
  expect(ask).toHaveBeenCalledOnce()
  expect(screen.getByText('另一段对话正在回答，完成后可继续提问。')).toBeInTheDocument()

  await act(async () => { pending.resolve({ answer: '迟到的回答' }); await pending.promise })
  await waitFor(() => expect(cache(qc, 'q1').some((message) => message.content === '迟到的回答')).toBe(true))
  expect(cache(qc, null)).toEqual([])
  expect(screen.getByLabelText('输入答疑问题')).toHaveValue('另一个范围的问题')
  await waitFor(() => expect(screen.getByRole('button', { name: '发送问题' })).toBeEnabled())
})

it('removes only the failed temporary message and preserves newer cache content', async () => {
  const pending = deferred<{ answer: string }>()
  vi.spyOn(api, 'ask').mockReturnValue(pending.promise)
  const { qc } = setup()
  fireEvent.change(screen.getByLabelText('输入答疑问题'), { target: { value: '会失败的问题' } })
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }))

  await waitFor(() => expect(cache(qc, 'q1').some((message) => message.content === '会失败的问题')).toBe(true))
  const optimistic = cache(qc, 'q1').find((message) => message.content === '会失败的问题')
  expect(optimistic?.id).toMatch(/^chat-temp-/)
  act(() => {
    qc.setQueryData(['chat', 'job', 'q1'], {
      messages: [...cache(qc, 'q1'), { role: 'assistant', content: '更新到的新内容' }],
    })
  })

  await act(async () => {
    pending.reject(new ApiError(0, '网络失败', 'network'))
    try { await pending.promise } catch { /* expected rejection */ }
  })
  await waitFor(() => expect(cache(qc, 'q1').some((message) => message.id === optimistic?.id)).toBe(false))
  expect(cache(qc, 'q1').map((message) => message.content)).toEqual(['旧内容', '更新到的新内容'])
  expect(screen.getByLabelText('输入答疑问题')).toHaveValue('会失败的问题')
})
