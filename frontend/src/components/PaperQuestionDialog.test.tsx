import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { api } from '../api'
import type { PaperQuestion } from '../types'
import { PaperQuestionDialog } from './PaperQuestionDialog'

function question(options: PaperQuestion['options']): PaperQuestion {
  return {
    id: 'q1', number: '1', section: null, type: '单选', stem: '原题干', options,
    passage: null, correct_answer: 'A', knowledge_point: null,
  }
}

function renderDialog(value: PaperQuestion, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><PaperQuestionDialog paperId="p1" question={value} onClose={onClose} /></QueryClientProvider>)
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
