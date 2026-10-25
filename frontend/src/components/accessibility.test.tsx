import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'
import type { Question } from '../types'
import { DonutChart } from './DonutChart'
import { QuestionGrid, type QuestionFilter } from './QuestionGrid'
import { StudentFilter } from './StudentFilter'

function QuestionGridHarness({ question }: { question: Question }) {
  const [filter, setFilter] = useState<QuestionFilter>('all')
  const [selectedQid, setSelectedQid] = useState<string | null>(null)
  return <QuestionGrid questions={[question]} filter={filter} selectedQid={selectedQid} onFilterChange={setFilter} onSelectQuestion={setSelectedQid} />
}

it('gives student filters and charts readable names', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  qc.setQueryData(['students'], {
    students: [
      { id: 1, name: '我自己', is_self: 1 },
      { id: 2, name: '小明', is_self: 0 },
    ],
  })
  render(<QueryClientProvider client={qc}><StudentFilter value={null} onChange={() => undefined} /></QueryClientProvider>)
  expect(screen.getByRole('combobox', { name: '按学生筛选' })).toBeInTheDocument()

  render(<DonutChart correct={3} total={4} />)
  expect(screen.getByRole('img', { name: '正确率 75%，答对 3 题，共 4 题' })).toBeInTheDocument()
})

it('exposes question selection and status to assistive technology', () => {
  const question: Question = {
    id: 'q1', number: '1', section: null, type: null, stem: null, options: null, passage: null,
    student_answer: null, correct_answer: 'A', status: 'wrong', knowledge_point: null,
    explanation: {}, explain_state: 'done', revision: 1,
  }
  render(<QuestionGridHarness question={question} />)
  const item = screen.getByRole('button', { name: '第 1 题，答错，已有讲解' })
  expect(item).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: '全部 1' })).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(item)
  expect(item).toHaveAttribute('aria-pressed', 'true')
})
