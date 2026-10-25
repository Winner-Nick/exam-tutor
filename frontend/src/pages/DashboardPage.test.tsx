import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { api, ApiError } from '../api'
import type { Paper, User } from '../types'
import { DashboardPage } from './DashboardPage'

function paper(id: string, title = id): Paper {
  return {
    id, title, status: 'ready', stage: null, progress: { done: 1, total: 1, label: null },
    error: null, page_count: 1, created_at: 1, meta: {}, question_count: 1,
    answered_count: 1, submission_count: 0,
  }
}

function setup({ entry = '/', papers = [paper('paper-1')], detail }: { entry?: string; papers?: Paper[]; detail?: Paper } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const listPapers = vi.spyOn(api, 'listPapers').mockImplementation(async () => ({ papers, total: papers.length }))
  const listJobs = vi.spyOn(api, 'listJobs').mockResolvedValue({ jobs: [], total: 0 })
  vi.spyOn(api, 'listStudents').mockResolvedValue({
    students: [{ id: 1, name: '我自己', is_self: 1, created_at: 1, submission_count: 0, wrong_total: 0 }],
  })
  const getPaper = vi.spyOn(api, 'getPaper').mockImplementation(async (id) => {
    if (detail?.id === id) return detail
    throw new ApiError(404, '试卷不存在')
  })
  const createSubmission = vi.spyOn(api, 'createSubmission').mockResolvedValue({ job_id: 'created-job' })
  const currentUser: User = { id: 1, username: 'teacher', role: 'user' }
  const router = createMemoryRouter([{
    path: '/', element: <Outlet context={currentUser} />, children: [
      { index: true, element: <DashboardPage /> },
      { path: 'jobs/:jobId', element: <div>创建后的记录</div> },
    ],
  }], { initialEntries: [entry] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return { qc, router, listPapers, listJobs, getPaper, createSubmission }
}

async function addPdf(name = 'answer.pdf') {
  const file = new File(['pdf'], name, { type: 'application/pdf' })
  const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText(name)
}

async function selectListedPaper() {
  await screen.findByRole('combobox', { name: '选择试卷' })
  fireEvent.change(screen.getByRole('combobox', { name: '选择试卷' }), { target: { value: 'paper-1' } })
  await addPdf()
}

afterEach(() => vi.useRealTimers())

it('submits a deep-linked paper outside the option page and navigates without waiting for invalidation', async () => {
  const old = paper('old-paper', '旧试卷')
  const { qc, router, getPaper, createSubmission } = setup({ entry: '/?paper=old-paper', papers: [], detail: old })
  await waitFor(() => expect(getPaper).toHaveBeenCalledWith('old-paper', expect.objectContaining({ signal: expect.any(AbortSignal) })))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '选择试卷' })).toHaveValue('old-paper'))
  await addPdf()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  const confirm = vi.spyOn(window, 'confirm')
  vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => new Promise<void>(() => undefined))

  fireEvent.click(screen.getByRole('button', { name: '开始批改' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/created-job'))
  expect(createSubmission).toHaveBeenCalledWith('old-paper', 1, expect.any(Array), false, expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect(confirm).not.toHaveBeenCalled()
})

it('reuses the key after network failures and rotates it after file input changes', async () => {
  const { createSubmission } = setup()
  createSubmission.mockRejectedValue(new ApiError(0, '网络失败', 'network'))
  await selectListedPaper()
  const button = screen.getByRole('button', { name: '开始批改' })

  fireEvent.click(button)
  await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(button).toBeEnabled())
  const firstKey = createSubmission.mock.calls[0][4]?.idempotencyKey

  fireEvent.click(button)
  await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(button).toBeEnabled())
  expect(createSubmission.mock.calls[1][4]?.idempotencyKey).toBe(firstKey)

  fireEvent.click(screen.getByRole('button', { name: '移除 answer.pdf' }))
  await addPdf()
  fireEvent.click(button)
  await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(3))
  expect(createSubmission.mock.calls[2][4]?.idempotencyKey).not.toBe(firstKey)
})

it('debounces record and paper-option searches and replaces search history', async () => {
  vi.useFakeTimers()
  const { router, listJobs, listPapers } = setup()
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  fireEvent.change(screen.getByRole('textbox', { name: '搜索批改记录' }), { target: { value: '数学' } })
  act(() => { vi.advanceTimersByTime(299) })
  expect(listJobs).not.toHaveBeenCalledWith(expect.objectContaining({ q: '数学' }), expect.anything())
  await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve() })
  expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ q: '数学' }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(router.state.historyAction).toBe('REPLACE')

  fireEvent.change(screen.getByRole('textbox', { name: '搜索可选试卷' }), { target: { value: '旧卷' } })
  act(() => { vi.advanceTimersByTime(299) })
  expect(listPapers).not.toHaveBeenCalledWith(expect.objectContaining({ q: '旧卷' }), expect.anything())
  await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve() })
  expect(listPapers).toHaveBeenCalledWith(expect.objectContaining({ q: '旧卷', limit: 200 }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('does not submit when the selected paper no longer exists', async () => {
  const { getPaper, createSubmission } = setup({ entry: '/?paper=deleted', papers: [] })
  await waitFor(() => expect(getPaper).toHaveBeenCalledWith('deleted', expect.anything()))
  await addPdf()

  expect(screen.getByRole('button', { name: '开始批改' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '开始批改' }))
  expect(createSubmission).not.toHaveBeenCalled()
})
