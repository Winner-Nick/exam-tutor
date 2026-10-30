import { useMemo } from 'react'
import type { Question } from '../types'

export type QuestionFilter = 'all' | 'wrong' | 'unknown' | 'correct' | 'subjective'

const FILTERS: { key: QuestionFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'wrong', label: '错题' },
  { key: 'unknown', label: '待确认' },
  { key: 'correct', label: '已对' },
  { key: 'subjective', label: '主观' },
]

const DOT_CLS: Record<Question['status'], string> = {
  correct:
    'bg-emerald-100/80 text-emerald-700 hover:bg-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-300',
  wrong: 'bg-rose-100/80 text-rose-700 hover:bg-rose-200/80 dark:bg-rose-900/40 dark:text-rose-300',
  unknown:
    'bg-amber-100/80 text-amber-700 hover:bg-amber-200/80 dark:bg-amber-900/40 dark:text-amber-300',
  subjective:
    'bg-violet-100/80 text-violet-700 hover:bg-violet-200/80 dark:bg-violet-900/40 dark:text-violet-300',
}

const STATUS_LABEL: Record<Question['status'], string> = {
  correct: '答对',
  wrong: '答错',
  unknown: '待确认',
  subjective: '主观题',
}

export function QuestionGrid({
  questions,
  filter,
  selectedQid,
  onFilterChange,
  onSelectQuestion,
}: {
  questions: Question[]
  filter: QuestionFilter
  selectedQid: string | null
  onFilterChange: (filter: QuestionFilter) => void
  onSelectQuestion: (qid: string) => void
}) {
  const counts = useMemo(() => {
    const result: Record<QuestionFilter, number> = { all: questions.length, wrong: 0, unknown: 0, correct: 0, subjective: 0 }
    for (const question of questions) result[question.status] += 1
    return result
  }, [questions])
  const visible = useMemo(
    () => filter === 'all' ? questions : questions.filter((question) => question.status === filter),
    [questions, filter],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">题目导航</p><span className="text-xs text-dim">{visible.length} 道题</span></div>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1 xl:flex-wrap xl:overflow-visible" role="group" aria-label="按判分状态筛选">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            aria-pressed={filter === f.key}
            className={`shrink-0 text-xs ${filter === f.key ? 'chip chip-active' : 'chip'}`}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 xl:grid-cols-5">
        {visible.map((q) => (
          <button
            key={q.id}
            onClick={() => onSelectQuestion(q.id)}
            title={`第 ${q.number} 题，${STATUS_LABEL[q.status]}`}
            aria-label={`第 ${q.number} 题，${STATUS_LABEL[q.status]}${q.status !== 'correct' && q.explanation ? '，已有讲解' : ''}`}
            aria-pressed={selectedQid === q.id}
            className={`relative flex h-11 items-center justify-center rounded-xl font-serif text-sm font-semibold transition-all ${DOT_CLS[q.status]} ${
              selectedQid === q.id ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-surface' : ''
            }`}
          >
            {q.number}
            {q.status !== 'correct' && q.explanation && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface bg-primary-500" />
            )}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="col-span-full py-8 text-center text-xs text-dim">该分类下没有题目</p>
        )}
      </div>
    </div>
  )
}
