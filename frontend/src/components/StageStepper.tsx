import type { Job } from '../types'

const STAGES = [
  { key: 'render', label: '渲染页面' },
  { key: 'vision', label: '识别内容' },
  { key: 'consolidate', label: '判分汇总' },
] as const

export function StageStepper({ job }: { job: Job }) {
  const order = ['queued', 'render', 'vision', 'consolidate', 'done']
  const cur = order.indexOf(job.stage || 'queued')
  const pct =
    job.progress && job.progress.total > 0
      ? Math.round((job.progress.done / job.progress.total) * 100)
      : 0

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="flex items-center justify-between">
        {STAGES.map((s, i) => {
          const idx = order.indexOf(s.key)
          const state = cur > idx ? 'done' : cur === idx ? 'active' : 'todo'
          return (
            <div key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                    state === 'done'
                      ? 'bg-emerald-500 text-white'
                      : state === 'active'
                        ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30'
                        : 'bg-slate-200 text-slate-400 dark:bg-slate-700'
                  }`}
                >
                  {state === 'done' ? '✓' : i + 1}
                </div>
                <span
                  className={`text-xs whitespace-nowrap ${
                    state === 'active' ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-slate-400'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div
                  className={`mx-2 mb-5 h-0.5 flex-1 rounded ${
                    cur > idx ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      <div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-primary-500 transition-[width] duration-500"
            style={{ width: `${job.stage === 'queued' ? 4 : Math.max(pct, 6)}%` }}
          />
        </div>
        <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          {job.progress?.label || '排队中…'}
        </p>
      </div>
    </div>
  )
}
