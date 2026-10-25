import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { PageHeader } from '../components/PageHeader'
import { StudentFilter } from '../components/StudentFilter'
import { useToast } from '../components/Toast'
import type { MistakeQuestion } from '../types'
import { invalidateLearningData } from '../utils/query'

type ReviewFilter = 'all' | 'pending' | 'mastered' | 'due'
type ReviewBody = { action: 'attempt' | 'mastered' | 'reopen'; answer?: string; result?: 'correct' | 'wrong' }

function formatTime(timestamp?: number | null) {
  return timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '暂无记录'
}

function MistakeCard({ question }: { question: MistakeQuestion }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [answer, setAnswer] = useState('')
  const [showAnswer, setShowAnswer] = useState(false)
  const review = question.review
  const mastered = review?.mastered ?? false
  const attempts = review?.attempts ?? question.review_attempts ?? []

  const mutation = useMutation({
    mutationFn: (body: ReviewBody) => api.review(question.job_id, question.id, body),
    onSuccess: async (_, body) => {
      toast(body.action === 'mastered' ? '已标记为掌握' : body.action === 'reopen' ? '已恢复到待复习' : body.result === 'correct' ? '已记录答对，下次复习已按间隔排期' : '已记录答错，已重新进入近期复习')
      if (body.action === 'attempt') setAnswer('')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '复习操作失败，请重试', 'error'),
  })

  function attempt(result: 'correct' | 'wrong') {
    if (!answer.trim()) {
      toast('请先输入这次重新作答的答案', 'error')
      return
    }
    mutation.mutate({ action: 'attempt', answer: answer.trim(), result })
  }

  return (
    <article id={`mistake-${question.job_id}-${question.id}`} className="mistake-card rounded-2xl border border-line bg-surface p-4 break-inside-avoid">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/jobs/${question.job_id}?qid=${encodeURIComponent(question.id)}`} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary-700 hover:underline dark:text-primary-300">
            {question.job_title} · 第 {question.number} 题 <Icon name="arrow-right" size={14} />
          </Link>
          <p className="text-xs text-ink2">{question.student_name || '未指定学生'}{question.knowledge_point ? ` · ${question.knowledge_point}` : ''}</p>
        </div>
        <span className={`badge ${mastered ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'}`}>{mastered ? '已掌握' : '待复习'}</span>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <p className="whitespace-pre-wrap leading-relaxed">{question.stem || '未识别到题干，请打开原题核对。'}</p>
        {question.options && <ul className="grid gap-1 sm:grid-cols-2">{Object.entries(question.options).map(([key, value]) => <li key={key} className="rounded-lg bg-surface-2 px-2.5 py-1.5"><b>{key}.</b> {value}</li>)}</ul>}
        <p className="text-ink2">上次作答：<span className="text-ink">{question.student_answer?.trim() || '未作答 / 未识别'}</span></p>
        {showAnswer && <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100"><span className="font-semibold">标准答案：</span>{question.correct_answer?.trim() || '未提供，请打开原题由老师核对'}</div>}
      </div>

      <div className="review-actions mt-3 flex flex-wrap gap-2">
        <button onClick={() => setShowAnswer((value) => !value)} aria-expanded={showAnswer} className="btn-outline px-3 text-sm"><Icon name="eye" size={14} />{showAnswer ? '隐藏答案' : '显示答案'}</button>
        <button disabled={mutation.isPending} onClick={() => mutation.mutate({ action: mastered ? 'reopen' : 'mastered' })} className={mastered ? 'btn-outline px-3 text-sm' : 'btn-primary px-3 text-sm'}>{mastered ? '恢复待复习' : '标记已掌握'}</button>
      </div>

      <div className="review-actions mt-4 rounded-xl bg-surface-2 p-3">
        <label htmlFor={`review-answer-${question.job_id}-${question.id}`} className="text-sm font-medium text-ink2">重新作答</label>
        <textarea id={`review-answer-${question.job_id}-${question.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} rows={2} className="input mt-1 bg-surface" placeholder="输入这次答案，再按实际情况记录答对或答错" />
        <div className="mt-2 flex flex-wrap gap-2"><button disabled={mutation.isPending || !answer.trim()} onClick={() => attempt('correct')} className="btn-primary px-3 text-sm">这次答对了</button><button disabled={mutation.isPending || !answer.trim()} onClick={() => attempt('wrong')} className="btn-outline px-3 text-sm">这次仍答错</button></div>
        <p className="mt-2 text-xs leading-relaxed text-ink2">答对按 1 / 3 / 7 / 16 / 30 天递进到期间隔；答错会回到近期复习。</p>
      </div>

      <div className="mt-3 grid gap-1 text-xs text-ink2 sm:grid-cols-3">
        <span>已复习 {review?.review_count ?? 0} 次</span>
        <span>连续答对 {review?.streak ?? 0} 次</span>
        <span>下次到期：{formatTime(review?.next_review_at)}</span>
      </div>
      <details className="review-history mt-2 rounded-xl border border-line px-3 py-2 text-sm">
        <summary className="min-h-8 cursor-pointer py-1 font-medium text-ink2">复习记录{review?.last_reviewed_at ? ` · 最近 ${formatTime(review.last_reviewed_at)}` : ''}</summary>
        {attempts.length > 0 ? <ul className="divide-y divide-line/60 pb-2">{attempts.map((item, index) => <li key={item.id ?? `${item.created_at}-${index}`} className="py-2"><div className="flex flex-wrap justify-between gap-2 text-xs text-ink2"><span>{formatTime(item.created_at)}</span><span className={item.result === 'correct' || item.result === 'mastered' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>{item.action === 'mastered' || item.result === 'mastered' ? '标记掌握' : item.action === 'reopen' || item.result === 'reopened' ? '恢复复习' : item.result === 'correct' ? '答对' : '答错'}</span></div><p className="mt-1 whitespace-pre-wrap">作答：{item.answer || '未填写'}</p></li>)}</ul> : <p className="pb-2 text-xs text-ink2">暂无逐次作答明细；汇总：复习 {review?.review_count ?? 0} 次，最近 {formatTime(review?.last_reviewed_at)}。</p>}
      </details>
      {question.explanation?.tips && <div className="mt-3 rounded-lg bg-primary-50/60 p-2.5 dark:bg-primary-900/20"><span className="flex items-center gap-1 text-xs font-semibold text-primary-800 dark:text-primary-200"><Icon name="sparkles" size={12} /> 记忆技巧</span><Markdown text={String(question.explanation.tips)} /></div>}
      {mutation.isPending && <p className="mt-2 text-sm text-ink2" role="status">正在保存复习结果…</p>}
    </article>
  )
}

function csvCell(value: unknown) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function MistakesPage() {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const studentId = Number(params.get('student_id')) || null
  const paperId = params.get('paper_id') ?? ''
  const reviewParam = params.get('review')
  const review: ReviewFilter = reviewParam === 'pending' || reviewParam === 'mastered' || reviewParam === 'due' ? reviewParam : 'all'
  const days = Number(params.get('days')) || undefined
  const keyword = params.get('q') ?? ''
  const deferredKeyword = useDeferredValue(keyword)

  const query = useQuery({
    queryKey: ['mistakes', { studentId, paperId, review, q: deferredKeyword, days }],
    queryFn: () => api.mistakes({ studentId, paperId: paperId || null, review, q: deferredKeyword, days }),
  })
  const papers = useQuery({ queryKey: ['papers', 'options'], queryFn: () => api.listPapers({ limit: 100 }) })
  const groups = query.data?.groups ?? []
  const rows = groups.flatMap((group) => group.questions)
  const filtered = !!(studentId || paperId || review !== 'all' || days || keyword)

  function update(key: string, value: string) {
    setParams((old) => {
      const next = new URLSearchParams(old)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  }

  function exportCsv() {
    if (!rows.length) return
    const header = ['知识点', '学生', '试卷', '题号', '题干', '上次作答', '标准答案', '复习状态', '复习次数', '连续答对', '下次到期', '原题链接']
    const data = rows.map((question) => [
      question.knowledge_point ?? '未归类', question.student_name ?? '', question.job_title, question.number,
      question.stem ?? '', question.student_answer ?? '', question.correct_answer ?? '',
      question.review?.mastered ? '已掌握' : '待复习', question.review?.review_count ?? 0,
      question.review?.streak ?? 0, formatTime(question.review?.next_review_at),
      `${location.origin}/jobs/${question.job_id}?qid=${encodeURIComponent(question.id)}`,
    ])
    const csv = '\ufeff' + [header, ...data].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `错题复习-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`已导出当前筛选的 ${rows.length} 道错题`)
  }

  return (
    <div className="mistakes-page space-y-5">
      <PageHeader
        title="错题复习"
        description="按知识点与到期时间安排复习；掌握、恢复和重新作答会同步更新统计。"
        helpAnchor="mistakes"
        actions={<><button disabled={!rows.length} onClick={exportCsv} className="btn-outline px-3"><Icon name="download" size={15} /> 导出 CSV</button><button disabled={!rows.length} onClick={() => window.print()} className="btn-outline px-3"><Icon name="file-text" size={15} /> 打印</button></>}
      />

      <section className="filter-panel card space-y-3 p-4" aria-label="错题筛选">
        <div className="flex flex-wrap gap-2" role="group" aria-label="复习状态">
          {([{ key: 'all', label: '全部' }, { key: 'pending', label: '待复习' }, { key: 'mastered', label: '已掌握' }, { key: 'due', label: '今日到期' }] as const).map((item) => <button key={item.key} aria-pressed={review === item.key} onClick={() => update('review', item.key === 'all' ? '' : item.key)} className={`chip ${review === item.key ? 'chip-active' : ''}`}>{item.label}</button>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className="mb-1 block text-xs font-medium text-ink2">关键词</span><input value={keyword} onChange={(event) => update('q', event.target.value)} className="input" placeholder="题干、答案或知识点" /></label>
          <label><span className="mb-1 block text-xs font-medium text-ink2">学生</span><StudentFilter value={studentId} onChange={(value) => update('student_id', value ? String(value) : '')} /></label>
          <label><span className="mb-1 block text-xs font-medium text-ink2">试卷</span><select value={paperId} onChange={(event) => update('paper_id', event.target.value)} className="input"><option value="">全部试卷</option>{(papers.data?.papers ?? []).map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '试卷'}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-medium text-ink2">批改日期</span><select value={days ?? ''} onChange={(event) => update('days', event.target.value)} className="input"><option value="">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="365">近一年</option></select></label>
        </div>
      </section>

      <p className="text-sm text-ink2" aria-live="polite">当前筛选共 {rows.length} 道错题</p>
      {query.isPending ? <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-44 rounded-2xl" />)}</div> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={filtered ? 'target' : 'party-popper'} title={filtered ? '没有符合筛选条件的错题' : '错题本是空的'} description={filtered ? '可清空筛选查看全部错题；已掌握题需切换到“已掌握”查看。' : '完成批改后，答错题会按知识点归集到这里。'} action={filtered ? <button onClick={() => setParams({})} className="btn-outline px-4">清空筛选</button> : undefined} />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => <section key={group.knowledge_point} className="mistake-group space-y-3"><h2 className="flex items-center gap-2 font-serif text-lg font-bold">{group.knowledge_point}<span className="badge bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{group.questions.length} 题</span></h2><div className="grid gap-4 xl:grid-cols-2">{group.questions.map((question) => <MistakeCard key={`${question.job_id}-${question.id}`} question={question} />)}</div></section>)}
        </div>
      )}
    </div>
  )
}
