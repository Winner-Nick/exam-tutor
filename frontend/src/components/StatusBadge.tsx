import type { QuestionStatus } from '../types'

export const STATUS_META: Record<QuestionStatus, { label: string; cls: string; dot: string }> = {
  correct: {
    label: '答对',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  wrong: {
    label: '答错',
    cls: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  unknown: {
    label: '待确认',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  subjective: {
    label: '主观题',
    cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
}

export function StatusBadge({ status }: { status: QuestionStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}
