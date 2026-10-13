import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { StudentFilter } from '../components/StudentFilter'

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
            <line x1={PAD} x2={W - PAD} y1={yy} y2={yy} className="stroke-line" strokeDasharray="4 4" />
            <text x={4} y={yy + 4} className="fill-dim text-[10px]">{y}%</text>
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
            <text x={x} y={y - 9} textAnchor="middle" className="fill-ink2 text-[10px] font-semibold">
              {p.pct}%
            </text>
            <text x={x} y={H - 8} textAnchor="middle" className="fill-dim text-[10px]">
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function StatsPage() {
  const [studentId, setStudentId] = useState<number | null>(null)
  const q = useQuery({
    queryKey: ['overview', studentId],
    queryFn: () => api.overview(studentId),
  })

  if (q.isPending)
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-44 rounded-2xl" />
        ))}
      </div>
    )
  if (q.isError) return <p className="py-16 text-center text-dim">加载失败，请刷新重试</p>

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
      <div className="flex justify-end">
        <StudentFilter value={studentId} onChange={setStudentId} />
      </div>
      <div className="card p-5">
        <h3 className="section-title mb-3 flex items-center gap-2">
          <Icon name="chart" size={17} className="text-primary-600 dark:text-primary-400" />
          客观题正确率趋势
        </h3>
        {points.length === 0 ? (
          <p className="py-8 text-center text-sm text-dim">还没有完成的试卷</p>
        ) : (
          <TrendChart points={points} />
        )}
      </div>

      <div className="card p-5">
        <h3 className="section-title mb-3 flex items-center gap-2">
          <Icon name="target" size={17} className="text-primary-600 dark:text-primary-400" />
          知识点错误率
        </h3>
        {knowledge_points.length === 0 ? (
          <p className="py-8 text-center text-sm text-dim">暂无知识点数据（错题讲解生成后自动归类）</p>
        ) : (
          <div className="space-y-2.5">
            {knowledge_points.map((kp) => {
              const pct = kp.total > 0 ? Math.round((kp.wrong / kp.total) * 100) : 0
              return (
                <div key={kp.knowledge_point} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate text-right text-xs text-ink2 sm:w-44" title={kp.knowledge_point}>
                    {kp.knowledge_point}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${pct >= 60 ? 'bg-rose-500' : pct >= 30 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-xs text-dim">
                    {kp.wrong}/{kp.total} 错
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="section-title mb-3 flex items-center gap-2">
          <Icon name="list" size={17} className="text-primary-600 dark:text-primary-400" />
          历次试卷
        </h3>
        <div className="divide-y divide-line/60 text-sm">
          {jobs.map((j) => {
            const graded = (j.stats.correct ?? 0) + (j.stats.wrong ?? 0)
            return (
              <Link
                key={j.id}
                to={`/jobs/${j.id}`}
                className="group flex items-center justify-between py-2.5 transition-colors hover:text-primary-600 dark:hover:text-primary-400"
              >
                <span className="truncate">
                  {j.title}
                  {j.student_name && (
                    <span className="ml-2 text-xs text-dim">{j.student_name}</span>
                  )}
                </span>
                <span className="ml-3 shrink-0 text-xs text-dim">
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
