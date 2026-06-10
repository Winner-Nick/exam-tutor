import { Markdown } from './Markdown'
import { Spinner } from './Spinner'
import type { Question } from '../types'

const SECTIONS: { key: keyof NonNullable<Question['explanation']>; label: string; icon: string }[] = [
  { key: 'knowledge_point', label: '考点', icon: '🎯' },
  { key: 'answer_analysis', label: '答案解析', icon: '💡' },
  { key: 'why_wrong', label: '易错点', icon: '⚠️' },
  { key: 'tips', label: '记忆技巧', icon: '✨' },
  { key: 'examples', label: '举一反三', icon: '📚' },
]

export function ExplanationCard({
  question,
  onRequestExplain,
}: {
  question: Question
  onRequestExplain: () => void
}) {
  const { explanation, explain_state } = question

  if (explanation) {
    return (
      <div className="fade-up space-y-3 rounded-2xl border border-primary-100 bg-primary-50/50 p-4 dark:border-primary-900/50 dark:bg-primary-900/10">
        <h4 className="text-sm font-bold text-primary-700 dark:text-primary-300">AI 讲解</h4>
        {SECTIONS.map(({ key, label, icon }) => {
          const text = explanation[key]
          if (!text) return null
          return (
            <div key={key}>
              <div className="mb-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {icon} {label}
              </div>
              <Markdown text={String(text)} />
            </div>
          )
        })}
      </div>
    )
  }

  if (explain_state === 'queued' || explain_state === 'generating') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Spinner className="h-5 w-5" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {explain_state === 'generating' ? 'AI 正在撰写讲解…' : '讲解排队中…'}
          </p>
          <div className="mt-2 space-y-1.5">
            <div className="h-2 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-2 w-3/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {explain_state === 'failed' ? '讲解生成失败' : '这道题还没有讲解'}
      </p>
      <button
        onClick={onRequestExplain}
        className="mt-2 rounded-xl bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
      >
        {explain_state === 'failed' ? '重新生成' : '生成讲解'}
      </button>
    </div>
  )
}
