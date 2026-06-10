import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Spinner } from '../components/Spinner'

/** 正确率趋势：纯 SVG 折线。 */
function TrendChart({
  points,
}: {
  points: { label: string; pct: number; id: string }[]
}) {
  if (points.length === 0) return null
  const W = 640
  const H = 160
  const PAD = 28
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0
  const xy = (i: number, pct: number) =>
    [PAD + i * step, H - PAD - (pct / 100) * (H - PAD * 2)] as const

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 50, 100].map((y) => {
        const [, yy] = xy(0, y)
        return (
          <g key={y}>
            <line x1={PAD} x2={W - PAD} y1={yy} y2={yy} className="stroke-slate-200 dark:stroke-slate-700" strokeDasharray="4 4" />
            <text x={4} y={yy + 4} className="fill-slate-400 text-[10px]">{y}%</text>
          </g>
        )
      })}
      {points.length > 1 && (
        <polyline
          fill="none"
          strokeWidth="2.5"
          className="stroke-primary-500"
          strokeLinejoin="round"
          points={points.map((p, i) => xy(i, p.pct).join(',')).join(' ')}
        />
      )}
      {points.map((p, i) => {
        const [x, y] = xy(i, p.pct)
        return (
          <g key={p.id}>
            <circle cx={x} cy={y} r="4" className="fill-primary-600" />
            <text x={x} y={y - 9} textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold dark:fill-slate-300">
              {p.pct}%
            </text>
            <text x={x} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function StatsPage() {
  const q = useQuery({ queryKey: ['overview'], queryFn: api.overview })

  if (q.isPending)
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  if (q.isError) return <p className="py-16 text-center text-slate-400">加载失败，请刷新重试</p>

  const { jobs, knowledge_points } = q.data
  const points = jobs
    .slice()
    .reverse()
    .map((j) => {
      const graded = (j.stats.correct ?? 0) + (j.stats.wrong ?? 0)
      return {
        id: j.id,
        label: new Date(j.created_at * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        pct: graded > 0 ? Math.round(((j.stats.correct ?? 0) / graded) * 100) : 0,
      }
    })

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 font-bold">📈 客观题正确率趋势</h3>
        {points.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">还没有完成的试卷</p>
        ) : (
          <TrendChart points={points} />
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 font-bold">🎯 知识点错误率</h3>
        {knowledge_points.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">暂无知识点数据（错题讲解生成后自动归类）</p>
        ) : (
          <div className="space-y-2.5">
            {knowledge_points.map((kp) => {
              const pct = kp.total > 0 ? Math.round((kp.wrong / kp.total) * 100) : 0
              return (
                <div key={kp.knowledge_point} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate text-right text-xs text-slate-500 sm:w-44 dark:text-slate-400" title={kp.knowledge_point}>
                    {kp.knowledge_point}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${pct >= 60 ? 'bg-rose-500' : pct >= 30 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-xs text-slate-400">
                    {kp.wrong}/{kp.total} 错
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 font-bold">🗂 历次试卷</h3>
        <div className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {jobs.map((j) => {
            const graded = (j.stats.correct ?? 0) + (j.stats.wrong ?? 0)
            return (
              <Link
                key={j.id}
                to={`/jobs/${j.id}`}
                className="flex items-center justify-between py-2.5 hover:text-primary-600"
              >
                <span className="truncate">{j.title}</span>
                <span className="ml-3 shrink-0 text-xs text-slate-400">
                  {new Date(j.created_at * 1000).toLocaleDateString('zh-CN')} ·{' '}
                  {graded > 0 ? `${Math.round(((j.stats.correct ?? 0) / graded) * 100)}%` : '—'}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
