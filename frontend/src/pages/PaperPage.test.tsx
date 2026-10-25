import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { api } from '../api'
import type { Paper } from '../types'
import { PaperPage } from './PaperPage'

it('applies the same type and answer limits to the add-question row', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const paper: Paper = {
    id: 'paper-1', title: '试卷', status: 'ready', stage: null,
    progress: { done: 1, total: 1, label: null }, error: null, page_count: 1,
    created_at: 1, meta: {}, question_count: 0, answered_count: 0, submission_count: 0,
    questions: [], files: [],
  }
  vi.spyOn(api, 'getPaper').mockResolvedValue(paper)
  const add = vi.spyOn(api, 'addPaperQuestion')
  const router = createMemoryRouter([{ path: '/papers/:paperId', element: <PaperPage /> }], { initialEntries: ['/papers/paper-1'] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)

  const type = await screen.findByLabelText('新题题型')
  const answer = screen.getByLabelText('新题标准答案')
  expect(type).toHaveAttribute('maxlength', '30')
  expect(answer).toHaveAttribute('maxlength', '500')
  fireEvent.change(screen.getByLabelText('新题号'), { target: { value: '1' } })
  expect(screen.getByRole('button', { name: '添加题目' })).toBeEnabled()
  fireEvent.change(type, { target: { value: 'x'.repeat(31) } })
  expect(screen.getByRole('button', { name: '添加题目' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '添加题目' }))
  expect(add).not.toHaveBeenCalled()
})
