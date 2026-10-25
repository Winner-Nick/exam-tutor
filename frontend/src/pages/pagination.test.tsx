import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { api } from '../api'
import type { Job, Paper, User } from '../types'
import { DashboardPage } from './DashboardPage'
import { PapersPage } from './PapersPage'

function makeJob(index: number): Job {
  return {
    id: `job-${index}`, filename: null, kind: 'submission', paper_id: 'paper', student_id: 1,
    student_name: '我自己', paper_title: `记录 ${index}`, status: 'done', stage: null,
    progress: { done: 1, total: 1, label: null }, error: null, page_count: 1,
    created_at: 1_700_000_000 + index, meta: {}, stats: { correct: 1, total: 1 },
  }
}

function makePaper(index: number): Paper {
  return {
    id: `paper-${index}`, title: `试卷 ${index}`, status: 'ready', stage: null,
    progress: { done: 1, total: 1, label: null }, error: null, page_count: 1,
    created_at: 1_700_000_000 + index, meta: {}, question_count: 1, answered_count: 1,
    submission_count: 0,
  }
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

it('returns Dashboard to a valid page after deleting the last item on the tail page', async () => {
  const user = userEvent.setup()
  let count = 10
  const listJobs = vi.spyOn(api, 'listJobs').mockImplementation(async ({ offset = 0 } = {}) => ({
    jobs: Array.from({ length: count }, (_, index) => makeJob(index)).slice(offset, offset + 9),
    total: count,
  }))
  vi.spyOn(api, 'deleteJob').mockImplementation(async () => { count = 9; return { ok: true } })
  vi.spyOn(api, 'listStudents').mockResolvedValue({
    students: [{ id: 1, name: '我自己', is_self: 1, created_at: 1, submission_count: 0, wrong_total: 0 }],
  })
  vi.spyOn(api, 'listPapers').mockResolvedValue({ papers: [], total: 0 })
  const currentUser: User = { id: 1, username: 'teacher', role: 'user' }
  const router = createMemoryRouter([{
    path: '/',
    element: <Outlet context={currentUser} />,
    children: [{ index: true, element: <DashboardPage /> }],
  }], { initialEntries: ['/?page=1'] })
  render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>)

  await user.click(await screen.findByRole('button', { name: '删除 记录 9' }))
  await user.click(screen.getByRole('button', { name: '确认删除' }))

  await waitFor(() => expect(router.state.location.search).toBe('?page=0'))
  await waitFor(() => expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }), expect.objectContaining({ signal: expect.any(AbortSignal) })))
  expect(await screen.findAllByRole('button', { name: /^删除 记录/ })).toHaveLength(9)
})

it('returns Papers to a valid page after deleting the last item on the tail page', async () => {
  const user = userEvent.setup()
  let count = 13
  const listPapers = vi.spyOn(api, 'listPapers').mockImplementation(async ({ offset = 0 } = {}) => ({
    papers: Array.from({ length: count }, (_, index) => makePaper(index)).slice(offset, offset + 12),
    total: count,
  }))
  vi.spyOn(api, 'deletePaper').mockImplementation(async () => { count = 12; return { ok: true } })
  const router = createMemoryRouter([{ path: '/', element: <PapersPage /> }], { initialEntries: ['/?page=1'] })
  render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>)

  await user.click(await screen.findByRole('button', { name: '删除 试卷 12' }))
  await user.click(screen.getByRole('button', { name: '确认删除' }))

  await waitFor(() => expect(router.state.location.search).toBe('?page=0'))
  await waitFor(() => expect(listPapers).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }), expect.objectContaining({ signal: expect.any(AbortSignal) })))
  expect(await screen.findAllByRole('button', { name: /^删除 试卷/ })).toHaveLength(12)
})
