import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { StudentFilter } from '../components/StudentFilter'
import type { OverviewJob, User } from '../types'

interface TrendPoint { label: string; pct: number; id: string }

function TrendChart({ points, label }: { points: TrendPoint[]; label: string }) {
  const width = 640
  const height = 170
  const pad = 30
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
  const xy = (index: number, pct: number) => [pad + index * step, height - pad - (pct / 100) * (height - pad * 2)] as const
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 50, 100].map((value) => {
        const [, y] = xy(0, value)
        return <g key={value}><line x1={pad} x2={width - pad} y1={y} y2={y} className="stroke-line" strokeDasharray="4 4" /><text x={4} y={y + 4} className="fill-ink2 text-[10px]">{value}%</text></g>
      })}
      {points.length > 1 && <polyline fill="none" strokeWidth="2.5" className="stroke-primary-600" strokeLinejoin="round" points={points.map((point, index) => xy(index, point.pct).join(',')).join(' ')} />}
      {points.map((point, index) => {
        const [x, y] = xy(index, point.pct)
        const showLabel = index % labelEvery === 0 || index === points.length - 1
        return <g key={point.id}><circle cx={x} cy={y} r="4" className="fill-primary-600"><title>{point.label}：{point.pct}%</title></circle>{showLabel && <><text x={x} y={Math.max(12, y - 9)} textAnchor="middle" className="fill-ink2 text-[10px] font-semibold">{point.pct}%</text><text x={x} y={height - 8} textAnchor="middle" className="fill-ink2 text-[10px]">{point.label}</text></>}</g>
      })}
    </svg>
  )
}

function gradedCount(job: OverviewJob) {
  return (job.stats.correct ?? 0) + (job.stats.wrong ?? 0)
}

export function StatsPage() {
  const user = useOutletContext<User>()
  const [studentId, setStudentId] = useState<number | null>(null)
  const [days, setDays] = useState(30)
  const query = useQuery({ queryKey: ['overview', { studentId, days }], queryFn: () => api.overview(studentId, days) })

  if (query.isPending) return <div className="space-y-4">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-44 rounded-2xl" />)}</div>
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const data = query.data
  const jobs = (data.jobs ?? []).slice().sort((a, b) => a.created_at - b.created_at)
  const knowledgePoints = data.knowledge_points ?? []
  const summary = data.summary ?? {
    total_jobs: jobs.length,
    correct: jobs.reduce((sum, job) => sum + (job.stats.correct ?? 0), 0),
    wrong: jobs.reduce((sum, job) => sum + (job.stats.wrong ?? 0), 0),
    unknown: jobs.reduce((sum, job) => sum + (job.stats.unknown ?? 0), 0),
    subjective: jobs.reduce((sum, job) => sum + (job.stats.subjective ?? 0), 0),
  }
  const noObjectiveJobs = summary.no_objective_jobs ?? jobs.filter((job) => gradedCount(job) === 0).length
  const personalMode = studentId != null || user.role === 'student'

  const personalPoints = jobs
    .filter((job) => gradedCount(job) > 0 && (studentId == null || job.student_id == null || job.student_id === studentId))
    .map((job) => ({
      id: job.id,
      label: new Date(job.created_at * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
      pct: Math.round(((job.stats.correct ?? 0) / gradedCount(job)) * 100),
    }))
    .slice(-30)

  const classDays = new Map<string, { correct: number; wrong: number; timestamp: number }>()
  for (const job of jobs) {
    if (gradedCount(job) === 0) continue
    const date = new Date(job.created_at * 1000)
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    const current = classDays.get(key) ?? { correct: 0, wrong: 0, timestamp: job.created_at }
    current.correct += job.stats.correct ?? 0
    current.wrong += job.stats.wrong ?? 0
    classDays.set(key, current)
  }
  const classPoints = Array.from(classDays.entries()).map(([key, value]) => ({
    id: key,
    label: new Date(value.timestamp * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    pct: Math.round((value.correct / (value.correct + value.wrong)) * 100),
  })).slice(-30)
  const points = personalMode ? personalPoints : classPoints

  const coverage = data.knowledge_coverage
  const coveragePercent = typeof coverage === 'number'
    ? coverage
    : coverage ? coverage.percent ?? (coverage.total > 0 ? Math.round((coverage.covered / coverage.total) * 100) : 0) : null
  const coverageCovered = typeof coverage === 'object' && coverage ? coverage.covered : null
  const coverageTotal = typeof coverage === 'object' && coverage ? coverage.total : null
  const studentSummaries = data.student_summaries ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        title="学习统计"
        description="正确率只统计可客观判分的题目；待确认与主观题单独呈现。"
        helpAnchor="stats"
        actions={<><StudentFilter value={studentId} onChange={setStudentId} /><label><span className="sr-only">统计时间范围</span><select value={days} onChange={(event) => setDays(Number(event.target.value))} className="input w-auto"><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={365}>近一年</option></select></label></>}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="统计摘要">
        {[{ label: '完成批改', value: summary.total_jobs }, { label: '待确认题', value: summary.unknown }, { label: '主观题', value: summary.subjective }, { label: '无客观题记录', value: noObjectiveJobs }].map((item) => <div key={item.label} className="card p-4"><p className="font-serif text-2xl font-bold">{item.value}</p><p className="mt-1 text-xs text-ink2">{item.label}</p></div>)}
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-1 flex items-center gap-2"><Icon name="chart" size={17} className="text-primary-600 dark:text-primary-400" />{personalMode ? '个人客观题正确率趋势' : '班级客观题正确率趋势（按日汇总）'}</h2>
        <p className="mb-3 text-xs text-ink2">{personalMode ? '仅连接同一学生、且有客观题的记录。' : '同一天按全班答对数与答错数汇总，不把不同学生依次连成个人折线。'}最多显示 30 个点。</p>
        {points.length === 0 ? <EmptyState icon="chart" title="当前范围未产生客观题正确率" description="只有主观题、全待确认或尚无完成记录时，不显示全对或 0% 趋势。" /> : <TrendChart points={points} label={personalMode ? '个人客观题正确率趋势' : '班级按日客观题正确率趋势'} />}
      </section>

      <section className="card p-5">
        <h2 className="section-title flex items-center gap-2"><Icon name="target" size={17} className="text-primary-600 dark:text-primary-400" /> 知识点覆盖率</h2>
        {coverageTotal === 0 ? <p className="mt-3 text-sm text-ink2">暂无可统计的题目。</p> : coveragePercent == null ? <p className="mt-3 text-sm text-ink2">暂无覆盖率数据。</p> : <div className="mt-3"><div className="flex items-end justify-between gap-3"><p className="font-serif text-2xl font-bold">{coveragePercent}%</p>{coverageCovered != null && <p className="text-sm text-ink2">已标注 {coverageCovered} / {coverageTotal} 道题</p>}</div><div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary-600" style={{ width: `${Math.min(100, Math.max(0, coveragePercent))}%` }} /></div>{coveragePercent < 100 && <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-200">覆盖不足：下方仅是已标注题目的“错题知识点分布”，不能视为完整掌握度。</p>}</div>}
        {knowledgePoints.length > 0 && <div className="mt-5 space-y-2.5"><h3 className="text-sm font-semibold">{coveragePercent != null && coveragePercent < 100 ? '错题知识点分布' : '知识点错误率'}</h3>{knowledgePoints.map((item) => { const pct = item.total > 0 ? Math.round((item.wrong / item.total) * 100) : 0; return <div key={item.knowledge_point} className="flex items-center gap-3 text-sm"><span className="w-32 truncate text-right text-xs text-ink2 sm:w-44" title={item.knowledge_point}>{item.knowledge_point}</span><div className="h-4 flex-1 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${pct >= 60 ? 'bg-rose-500' : pct >= 30 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.max(pct, 4)}%` }} /></div><span className="w-20 shrink-0 text-xs text-ink2">{item.wrong}/{item.total} 错</span></div> })}</div>}
      </section>

      {studentSummaries.length > 0 && !personalMode && <section className="card overflow-hidden p-5"><h2 className="section-title mb-3">学生汇总</h2><div className="divide-y divide-line/60">{studentSummaries.map((item) => { const graded = item.correct + item.wrong; return <button key={item.student_id} onClick={() => setStudentId(item.student_id)} className="flex min-h-14 w-full flex-wrap items-center gap-2 py-2 text-left hover:text-primary-700 dark:hover:text-primary-300"><span className="min-w-0 flex-1 truncate font-medium">{item.student_name}</span><span className="text-xs text-ink2">{item.total_jobs} 次批改 · 待确认 {item.unknown} · 主观 {item.subjective}</span><span className="text-sm font-semibold">{graded > 0 ? `${Math.round((item.correct / graded) * 100)}%` : '未产生客观题正确率'}</span></button> })}</div></section>}

      <section className="card p-5">
        <h2 className="section-title mb-3 flex items-center gap-2"><Icon name="list" size={17} className="text-primary-600 dark:text-primary-400" /> 时间范围内的批改</h2>
        {jobs.length === 0 ? <p className="py-8 text-center text-sm text-ink2">当前时间范围没有批改记录。</p> : <div className="divide-y divide-line/60 text-sm">{jobs.slice().reverse().map((job) => { const graded = gradedCount(job); return <Link key={job.id} to={`/jobs/${job.id}`} className="group flex min-h-12 flex-wrap items-center justify-between gap-2 py-2.5 hover:text-primary-700 dark:hover:text-primary-300"><span className="min-w-0 flex-1 truncate">{job.title}{job.student_name && <span className="ml-2 text-xs text-ink2">{job.student_name}</span>}</span><span className="shrink-0 text-xs text-ink2">{new Date(job.created_at * 1000).toLocaleDateString('zh-CN')} · {graded > 0 ? `${Math.round(((job.stats.correct ?? 0) / graded) * 100)}%` : '未产生客观题正确率'}</span></Link> })}</div>}
      </section>
    </div>
  )
}
