import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { api } from '../api'
import type { Job, Question } from '../types'
import { QuestionDetail } from './QuestionDetail'

function question(overrides: Partial<Question>): Question {
  return {
    id: 'q1', number: '1', section: null, type: '单选', stem: '题干', options: null,
    passage: null, student_answer: null, correct_answer: 'A', status: 'wrong',
    knowledge_point: null, explanation: null, explain_state: 'none', revision: 1,
    ...overrides,
  }
}

function setup(value: Question) {
  const qc = new QueryClient()
  const job: Job = {
    id: 'job', filename: null, kind: 'submission', paper_id: 'paper', student_id: 1,
    student_name: '小明', paper_title: '试卷', status: 'done', stage: null,
    progress: { done: 1, total: 1, label: null }, error: null, page_count: 1,
    created_at: 1, meta: {}, stats: {}, questions: [value], files: [],
  }
  const override = vi.spyOn(api, 'override').mockImplementation(async (_jobId, _qid, body) => ({
    question: { ...value, student_answer: body.student_answer ?? null },
    stats: { total: 0, correct: 0, wrong: 0, unknown: 0, subjective: 0 },
  }))
  render(<QueryClientProvider client={qc}><QuestionDetail job={job} question={value} /></QueryClientProvider>)
  return { override }
}

it('edits a multiple-choice answer as a set and highlights all selected and correct options', async () => {
  const { override } = setup(question({
    type: '多选', options: { A: '甲', B: '乙', C: '丙' }, correct_answer: 'A、C', student_answer: 'A',
  }))
  const save = screen.getByRole('button', { name: '保存作答' })
  expect(save).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /^A/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /^B/ })).not.toBeChecked()
  expect(screen.getAllByText('✓ 正确')).toHaveLength(2)

  fireEvent.click(screen.getByRole('checkbox', { name: /^C/ }))
  expect(save).toBeEnabled()
  expect(screen.getAllByText('学生选')).toHaveLength(2)
  fireEvent.click(save)

  await waitFor(() => expect(override).toHaveBeenCalledWith('job', 'q1', { student_answer: 'AC' }))
})

it('keeps single-choice options as immediate single-answer buttons', async () => {
  const { override } = setup(question({ options: { A: '甲', B: '乙' }, correct_answer: 'A' }))
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /^B/ }))

  await waitFor(() => expect(override).toHaveBeenCalledWith('job', 'q1', { student_answer: 'B' }))
})

it('sends explicit null when clearing an existing text answer', async () => {
  const { override } = setup(question({ options: null, student_answer: '旧答案' }))
  fireEvent.change(screen.getByLabelText('修正文本作答'), { target: { value: '' } })
  const save = screen.getByRole('button', { name: '保存作答' })
  expect(save).toBeEnabled()

  fireEvent.click(save)

  await waitFor(() => expect(override).toHaveBeenCalledWith('job', 'q1', { student_answer: null }))
})
