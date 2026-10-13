import { useUi, type Filter } from '../store'
import type { Question } from '../types'

const FILTERS: { key: Filter; label: string }[] = [
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

export function QuestionGrid({ questions }: { questions: Question[] }) {
  const { filter, setFilter, selectedQid, setSelectedQid, setMobileTab } = useUi()

  const counts: Record<Filter, number> = {
    all: questions.length,
    wrong: questions.filter((q) => q.status === 'wrong').length,
    unknown: questions.filter((q) => q.status === 'unknown').length,
    correct: questions.filter((q) => q.status === 'correct').length,
    subjective: questions.filter((q) => q.status === 'subjective').length,
  }
  const visible = filter === 'all' ? questions : questions.filter((q) => q.status === filter)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === f.key ? 'chip chip-active' : 'chip'
            }`}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-5 xl:grid-cols-6">
        {visible.map((q) => (
          <button
            key={q.id}
            onClick={() => {
              setSelectedQid(q.id)
              setMobileTab('detail')
            }}
            title={`第 ${q.number} 题`}
            className={`relative flex h-9 items-center justify-center rounded-lg font-serif text-xs font-semibold transition-all ${DOT_CLS[q.status]} ${
              selectedQid === q.id ? 'ring-2 ring-primary-500 ring-offset-1 ring-offset-surface' : ''
            }`}
          >
            {q.number}
            {q.status !== 'correct' && q.explanation && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary-500" title="已有讲解" />
            )}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-dim">该分类下没有题目</p>
        )}
      </div>
    </div>
  )
}
