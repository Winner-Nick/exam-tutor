import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { api } from '../api'
import type { Overview, OverviewJob, User } from '../types'
import { StatsPage } from './StatsPage'

const job: OverviewJob = {
  id: 'job-current', title: '当前记录', student_id: 1, student_name: '我自己', created_at: 1,
  stats: { correct: 0, wrong: 1, unknown: 0, subjective: 0, total: 1 },
}

function overview(offset: number): Overview {
  return {
    jobs: offset === 0 ? [job] : [],
    job_total: 51,
    job_limit: 50,
    job_offset: offset,
    trend: [{ id: 'backend-trend', label: '1/2', pct: 77 }],
    knowledge_points: [],
    summary: { total_jobs: 51, correct: 0, wrong: 51, unknown: 0, subjective: 0, no_objective_jobs: 0 },
    knowledge_coverage: { covered: 0, total: 0, percent: 0 },
    student_summaries: [],
  }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const overviewMock = vi.spyOn(api, 'overview').mockImplementation(async (_studentId, _days, options) => overview(options?.jobOffset ?? 0))
  vi.spyOn(api, 'listStudents').mockResolvedValue({
    students: [{ id: 1, name: '我自己', is_self: 1, created_at: 1, submission_count: 0, wrong_total: 0 }],
  })
  const user: User = { id: 1, username: 'teacher', role: 'user' }
  const router = createMemoryRouter([{ path: '/', element: <Outlet context={user} />, children: [{ index: true, element: <StatsPage /> }] }])
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return { overviewMock }
}

it('renders backend trend instead of deriving points from the jobs page', async () => {
  const { overviewMock } = setup()
  await screen.findByText('当前记录')

  expect(document.querySelector('circle title')?.textContent).toBe('1/2：77%')
  expect(overviewMock).toHaveBeenCalledWith(null, 30, expect.objectContaining({ jobLimit: 50, jobOffset: 0 }))
})

it('uses job_limit pagination and recovers from an empty page', async () => {
  const { overviewMock } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '下一页' }))

  await waitFor(() => expect(overviewMock).toHaveBeenCalledWith(null, 30, expect.objectContaining({ jobOffset: 50 })))
  await waitFor(() => expect(overviewMock.mock.calls.length).toBeGreaterThanOrEqual(3))
  expect(overviewMock.mock.calls[overviewMock.mock.calls.length - 1]?.[2]).toMatchObject({ jobLimit: 50, jobOffset: 0 })
  expect(await screen.findByText('当前记录')).toBeInTheDocument()
  expect(screen.getByText('第 1 / 2 页，共 51 条')).toBeInTheDocument()
})
