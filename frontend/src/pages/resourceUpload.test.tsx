import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { api, ApiError } from '../api'
import type { Job, Paper, User } from '../types'
import { compressPicked } from '../utils/compressImage'
import { JobPage } from './JobPage'
import { PaperPage } from './PaperPage'

vi.mock('../hooks/useJobEvents', () => ({ useJobEvents: () => ({ sseDown: false }) }))
vi.mock('../utils/compressImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/compressImage')>()),
  compressPicked: vi.fn(),
}))

const compressMock = vi.mocked(compressPicked)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeJob(id: string): Job {
  return {
    id, filename: null, kind: 'submission', paper_id: 'paper', student_id: 1, student_name: '我自己',
    paper_title: id, status: 'done', stage: null, progress: { done: 1, total: 1, label: null },
    error: null, page_count: 1, created_at: 1, meta: {}, stats: {}, questions: [], files: [],
  }
}

function makePaper(id: string): Paper {
  return {
    id, title: id, status: 'ready', stage: null, progress: { done: 1, total: 1, label: null },
    error: null, page_count: 1, created_at: 1, meta: {}, question_count: 0, answered_count: 0,
    submission_count: 0, questions: [], files: [],
  }
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

it('drops Job compression results from the previous resource ID', async () => {
  const pending = deferred<{ files: File[]; dropped: number }>()
  compressMock.mockReturnValue(pending.promise)
  vi.spyOn(api, 'getJob').mockImplementation(async (id) => makeJob(id))
  const addFiles = vi.spyOn(api, 'addSubmissionFiles').mockResolvedValue({ ok: true })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const currentUser: User = { id: 1, username: 'teacher', role: 'user' }
  const router = createMemoryRouter([{
    path: '/', element: <Outlet context={currentUser} />, children: [{ path: 'jobs/:jobId', element: <JobPage /> }],
  }], { initialEntries: ['/jobs/job-1'] })
  render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'job-1' })
  const oldFile = new File(['pdf'], 'old-job.pdf', { type: 'application/pdf' })
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!, { target: { files: [oldFile] } })
  await waitFor(() => expect(compressMock).toHaveBeenCalledOnce())

  act(() => { void router.navigate('/jobs/job-2') })
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-2'))
  await screen.findByRole('heading', { name: 'job-2' })
  await act(async () => { pending.resolve({ files: [oldFile], dropped: 0 }); await pending.promise })

  expect(screen.queryByText('old-job.pdf')).not.toBeInTheDocument()
  expect(addFiles).not.toHaveBeenCalled()
})

it('aborts Paper upload and clears pending files when the resource ID changes', async () => {
  const file = new File(['pdf'], 'old-paper.pdf', { type: 'application/pdf' })
  compressMock.mockResolvedValue({ files: [file], dropped: 0 })
  vi.spyOn(api, 'getPaper').mockImplementation(async (id) => makePaper(id))
  let signal: AbortSignal | undefined
  const addAnswers = vi.spyOn(api, 'addPaperFiles').mockImplementation((_id, _files, _kind, options) => {
    signal = options?.signal
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new ApiError(0, '已停止等待，请检查记录是否已创建', 'abort')), { once: true })
    })
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const router = createMemoryRouter([{ path: '/papers/:paperId', element: <PaperPage /> }], { initialEntries: ['/papers/paper-1'] })
  render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'paper-1' })
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!, { target: { files: [file] } })
  await screen.findByText('old-paper.pdf')
  fireEvent.click(screen.getByRole('button', { name: '上传 1 个答案文件' }))
  await waitFor(() => expect(addAnswers).toHaveBeenCalledOnce())
  expect(signal?.aborted).toBe(false)

  act(() => { void router.navigate('/papers/paper-2') })
  await waitFor(() => expect(router.state.location.pathname).toBe('/papers/paper-2'))
  await waitFor(() => expect(signal?.aborted).toBe(true))
  await screen.findByRole('heading', { name: 'paper-2' })

  expect(screen.queryByText('old-paper.pdf')).not.toBeInTheDocument()
})
