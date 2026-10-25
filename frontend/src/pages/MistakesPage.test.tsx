import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { api } from '../api'
import type { MistakeQuestion } from '../types'
import { MistakesPage } from './MistakesPage'

function mistake(id: string, stem = id): MistakeQuestion {
  return {
    id, number: '1', section: null, type: '单选', stem, options: null, passage: null,
    student_answer: 'A', correct_answer: 'B', status: 'wrong', knowledge_point: '代数',
    explanation: null, explain_state: 'none', revision: 1, job_id: 'job-1', job_title: '试卷',
    student_id: 1, student_name: '小明', created_at: 1,
    review: { mastered: false, review_count: 0, streak: 0, last_reviewed_at: null, next_review_at: null },
  }
}

function setup(entry = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.spyOn(api, 'listPapers').mockResolvedValue({ papers: [], total: 0 })
  vi.spyOn(api, 'listStudents').mockResolvedValue({
    students: [{ id: 1, name: '小明', is_self: 0, created_at: 1, submission_count: 0, wrong_total: 1 }],
  })
  const router = createMemoryRouter([{ path: '/', element: <MistakesPage /> }], { initialEntries: [entry] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return { qc, router }
}

it('uses server pagination and recovers from an out-of-range empty page', async () => {
  const list = vi.spyOn(api, 'mistakes').mockImplementation(async (filters = {}) => ({
    groups: filters.offset ? [] : [{ knowledge_point: '代数', questions: [mistake('current', '当前题')] }],
    total: 20,
    limit: filters.limit ?? 20,
    offset: filters.offset ?? 0,
  }))
  const { router } = setup('/?page=1')

  await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 20 }), expect.anything()))
  await waitFor(() => expect(router.state.location.search).toBe('?page=0'))
  expect(await screen.findByText('当前题')).toBeInTheDocument()
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }), expect.anything())
})

it('keeps a reasonable page after review removes the last item on a tail page', async () => {
  let reviewed = false
  vi.spyOn(api, 'mistakes').mockImplementation(async (filters = {}) => ({
    groups: filters.offset
      ? reviewed ? [] : [{ knowledge_point: '代数', questions: [mistake('tail', '尾页题')] }]
      : [{ knowledge_point: '代数', questions: [mistake('first', '首页题')] }],
    total: reviewed ? 20 : 21,
    limit: 20,
    offset: filters.offset ?? 0,
  }))
  vi.spyOn(api, 'review').mockImplementation(async () => { reviewed = true; return { question: mistake('tail') } })
  const { router } = setup('/?page=1&review=pending')

  fireEvent.click(await screen.findByRole('button', { name: '标记已掌握' }))

  await waitFor(() => expect(router.state.location.search).toBe('?page=0&review=pending'))
  expect(await screen.findByText('首页题')).toBeInTheDocument()
})

it('exports all filtered rows with limit=0 rather than only the current page', async () => {
  const list = vi.spyOn(api, 'mistakes').mockImplementation(async (filters = {}) => ({
    groups: [{ knowledge_point: '代数', questions: filters.limit === 0 ? [mistake('current', '当前页题'), mistake('other', '另一页题')] : [mistake('current', '当前页题')] }],
    total: 21,
    limit: filters.limit ?? 20,
    offset: filters.offset ?? 0,
  }))
  setup()
  await screen.findByText('当前页题')
  let exported: Blob | undefined
  const createObjectURL = vi.fn((blob: Blob) => { exported = blob; return 'blob:export' })
  const revokeObjectURL = vi.fn()
  const OriginalURL = URL
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL(blob: Blob) { return createObjectURL(blob) }
    static revokeObjectURL(url: string) { revokeObjectURL(url) }
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

  fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))

  await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 0, offset: 0 })))
  await waitFor(() => expect(exported).toBeDefined())
  const csv = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(exported!)
  })
  expect(csv).toContain('另一页题')
})
