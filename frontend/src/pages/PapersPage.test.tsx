import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { api, ApiError } from '../api'
import { PapersPage } from './PapersPage'

it('reuses a createPaper key after abort and rotates it when form details change', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.spyOn(api, 'listPapers').mockResolvedValue({ papers: [], total: 0 })
  const createPaper = vi.spyOn(api, 'createPaper').mockRejectedValue(new ApiError(0, '已停止等待，请检查记录是否已创建', 'abort'))
  const router = createMemoryRouter([{ path: '/', element: <PapersPage /> }])
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!, { target: { files: [file] } })
  await screen.findByText('paper.pdf')
  const button = screen.getByRole('button', { name: '开始识别' })

  fireEvent.click(button)
  await waitFor(() => expect(createPaper).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(button).toBeEnabled())
  const firstKey = createPaper.mock.calls[0][2]?.idempotencyKey

  fireEvent.click(button)
  await waitFor(() => expect(createPaper).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(button).toBeEnabled())
  expect(createPaper.mock.calls[1][2]?.idempotencyKey).toBe(firstKey)

  fireEvent.change(screen.getByRole('textbox', { name: '试卷名称' }), { target: { value: '新名称' } })
  fireEvent.click(button)
  await waitFor(() => expect(createPaper).toHaveBeenCalledTimes(3))
  expect(createPaper.mock.calls[2][2]?.idempotencyKey).not.toBe(firstKey)
})
