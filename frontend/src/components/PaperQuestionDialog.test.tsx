import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { api } from '../api'
import type { PaperQuestion } from '../types'
import { PaperQuestionDialog } from './PaperQuestionDialog'
import { ToastProvider } from './Toast'

function question(options: PaperQuestion['options']): PaperQuestion {
  return {
    id: 'q1', number: '1', section: null, type: '单选', stem: '原题干', options,
    passage: null, correct_answer: 'A', knowledge_point: null,
  }
}

function renderDialog(value: PaperQuestion, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><ToastProvider><PaperQuestionDialog paperId="p1" question={value} onClose={onClose} /></ToastProvider></QueryClientProvider>)
  return onClose
}

it('preserves the original options object when only other fields changed', async () => {
  const original = { A: '第一行\n第二行', B: '另一个选项' }
  const update = vi.spyOn(api, 'updatePaperQuestion').mockResolvedValue({ question: question(original), regraded: 0 })
  const onClose = renderDialog(question(original))
  const textarea = screen.getByRole('textbox', { name: /^选项/ })
  expect(textarea).toHaveValue('A. 第一行\n  第二行\nB. 另一个选项')

  fireEvent.change(screen.getByRole('textbox', { name: '题干' }), { target: { value: '新题干' } })
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }))

  await waitFor(() => expect(update).toHaveBeenCalledOnce())
  expect(update.mock.calls[0][2].options).toBe(original)
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
})

it('shows a parse error and does not save malformed options', async () => {
  const update = vi.spyOn(api, 'updatePaperQuestion')
  renderDialog(question({ A: '原选项' }))

  fireEvent.change(screen.getByRole('textbox', { name: /^选项/ }), { target: { value: '无法解析的内容' } })
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('第 1 行无法解析')
  expect(update).not.toHaveBeenCalled()
})

it('enforces backend field lengths before saving', () => {
  const update = vi.spyOn(api, 'updatePaperQuestion')
  renderDialog(question(null))

  expect(screen.getByRole('textbox', { name: '题号' })).toHaveAttribute('maxlength', '20')
  expect(screen.getByRole('textbox', { name: '题型' })).toHaveAttribute('maxlength', '30')
  expect(screen.getByRole('textbox', { name: '题干' })).toHaveAttribute('maxlength', '10000')
  expect(screen.getByRole('textbox', { name: /阅读材料/ })).toHaveAttribute('maxlength', '20000')
  expect(screen.getByRole('textbox', { name: '标准答案' })).toHaveAttribute('maxlength', '500')
  expect(screen.getByRole('textbox', { name: '知识点' })).toHaveAttribute('maxlength', '200')

  fireEvent.change(screen.getByRole('textbox', { name: '题型' }), { target: { value: 'x'.repeat(31) } })
  expect(screen.getByRole('button', { name: '保存题目' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }))
  expect(update).not.toHaveBeenCalled()
})

it('reports background reconciliation instead of claiming it completed', async () => {
  vi.spyOn(api, 'updatePaperQuestion').mockResolvedValue({
    question: question(null), regraded: 2, regrade_pending: true, pending_sync: 2,
  })
  const onClose = renderDialog(question(null))
  fireEvent.click(screen.getByRole('button', { name: '保存题目' }))

  expect(await screen.findByText('题目已保存，2 份历史作答将在后台同步')).toBeInTheDocument()
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
})
