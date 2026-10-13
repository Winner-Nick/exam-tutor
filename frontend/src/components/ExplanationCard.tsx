import { Icon, type IconName } from './Icon'
import { Markdown } from './Markdown'
import { Spinner } from './Spinner'
import type { Question } from '../types'

const SECTIONS: { key: keyof NonNullable<Question['explanation']>; label: string; icon: IconName }[] = [
  { key: 'knowledge_point', label: '考点', icon: 'target' },
  { key: 'answer_analysis', label: '答案解析', icon: 'lightbulb' },
  { key: 'why_wrong', label: '易错点', icon: 'alert' },
  { key: 'tips', label: '记忆技巧', icon: 'sparkles' },
  { key: 'examples', label: '举一反三', icon: 'book-open' },
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
      <div className="fade-up space-y-3.5 rounded-2xl border border-primary-200/70 bg-primary-50/40 p-4 dark:border-primary-900/50 dark:bg-primary-900/10">
        <h4 className="flex items-center gap-1.5 text-sm font-bold text-primary-700 dark:text-primary-300">
          <Icon name="sparkles" size={15} /> AI 讲解
        </h4>
        {SECTIONS.map(({ key, label, icon }) => {
          const text = explanation[key]
          if (!text) return null
          return (
            <div key={key}>
              <div className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-dim">
                <Icon name={icon} size={13} /> {label}
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
      <div className="card flex items-center gap-3 p-4">
        <Spinner className="h-5 w-5" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {explain_state === 'generating' ? 'AI 正在撰写讲解…' : '讲解排队中…'}
          </p>
          <div className="mt-2 space-y-1.5">
            <div className="skeleton h-2 w-4/5" />
            <div className="skeleton h-2 w-3/5" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-dashed border-line-strong p-5 text-center">
      <Icon name="sparkles" size={22} className="mx-auto text-dim" />
      <p className="mt-2 text-sm text-dim">
        {explain_state === 'failed' ? '讲解生成失败' : '这道题还没有讲解'}
      </p>
      <button onClick={onRequestExplain} className="btn-primary mt-3 px-4 py-1.5 text-sm">
        {explain_state === 'failed' ? '重新生成' : '生成讲解'}
      </button>
    </div>
  )
}
