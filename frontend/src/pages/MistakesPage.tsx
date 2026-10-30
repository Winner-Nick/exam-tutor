import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { StudentFilter } from '../components/StudentFilter'
import { useToast } from '../components/Toast'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { MistakeQuestion } from '../types'
import { emptyPageTarget } from '../utils/pagination'
import { invalidateReviewData } from '../utils/query'

const PAGE_SIZE = 20

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
  const [reviewing, setReviewing] = useState(false)
  const review = question.review
  const mastered = review?.mastered ?? false
  const attempts = review?.attempts ?? question.review_attempts ?? []

  const mutation = useMutation({
    mutationFn: (body: ReviewBody) => api.review(question.job_id, question.id, body),
    onSuccess: async (_, body) => {
      toast(body.action === 'mastered' ? '已标记为掌握' : body.action === 'reopen' ? '已恢复到待复习' : body.result === 'correct' ? '已记录答对，下次复习已按间隔排期' : '已记录答错，已重新进入近期复习')
      if (body.action === 'attempt') {
        setAnswer('')
        setReviewing(false)
      }
      await invalidateReviewData(qc)
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
    <article id={`mistake-${question.job_id}-${question.id}`} className="mistake-card card p-4 break-inside-avoid sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link to={`/jobs/${question.job_id}?qid=${encodeURIComponent(question.id)}`} className="flex min-h-11 max-w-full items-center gap-1.5 font-medium text-primary-700 hover:underline dark:text-primary-300">
            <span className="min-w-0 flex-1 truncate">{question.job_title}</span><span className="shrink-0">· 第 {question.number} 题</span><Icon name="arrow-up-right" size={15} />
          </Link>
          <p className="text-xs text-ink2">{question.student_name || '未指定学生'}{question.knowledge_point ? ` · ${question.knowledge_point}` : ''}</p>
        </div>
        <span className={`badge shrink-0 ${mastered ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/35 dark:text-amber-200'}`}>{mastered ? '已掌握' : '待复习'}</span>
      </div>

      <div className="mt-3 space-y-3 text-sm">
        <p className="text-[15px] leading-7 whitespace-pre-wrap">{question.stem || '未识别到题干，请打开原题核对。'}</p>
        {question.options && <ul className="grid gap-1.5 sm:grid-cols-2">{Object.entries(question.options).map(([key, value]) => <li key={key} className="rounded-xl bg-surface-2/65 px-3 py-2 leading-6"><b className="mr-1">{key}.</b>{value}</li>)}</ul>}
        <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3 dark:border-rose-900/40 dark:bg-rose-950/20"><p className="text-xs text-dim">上次作答</p><p className="mt-1 whitespace-pre-wrap text-rose-900 dark:text-rose-100">{question.student_answer?.trim() || '未作答 / 未识别'}</p></div>
        {showAnswer && <div className="fade-up rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-100"><p className="text-xs font-medium">标准答案</p><p className="mt-1 whitespace-pre-wrap">{question.correct_answer?.trim() || '未提供，请打开原题由老师核对'}</p></div>}
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line/60 rounded-xl bg-surface-2/55 py-2.5 text-center text-xs text-ink2">
        <span>复习 {review?.review_count ?? 0} 次</span><span>连对 {review?.streak ?? 0} 次</span><span className="px-1">{review?.next_review_at ? `${formatTime(review.next_review_at)} 到期` : '暂未排期'}</span>
      </div>

      <div className="review-actions mt-4 flex flex-wrap gap-2">
        <button onClick={() => setReviewing((value) => !value)} aria-expanded={reviewing} className="btn-primary px-3.5 text-sm"><Icon name="pen" size={14} />{reviewing ? '收起作答' : '重新作答'}</button>
        <button onClick={() => setShowAnswer((value) => !value)} aria-expanded={showAnswer} className="btn-outline px-3.5 text-sm"><Icon name={showAnswer ? 'eye-off' : 'eye'} size={14} />{showAnswer ? '隐藏答案' : '显示答案'}</button>
        <button disabled={mutation.isPending} onClick={() => mutation.mutate({ action: mastered ? 'reopen' : 'mastered' })} className="btn-ghost px-3 text-sm">{mastered ? '恢复待复习' : '标记已掌握'}</button>
      </div>

      {reviewing && <div className="review-actions fade-up mt-3 rounded-2xl border border-line/70 bg-surface-2/55 p-3.5">
        <label htmlFor={`review-answer-${question.job_id}-${question.id}`} className="text-sm font-semibold text-ink">这次你的答案是什么？</label>
        <textarea id={`review-answer-${question.job_id}-${question.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} className="input mt-2 bg-surface" placeholder="写下答案，再按实际情况记录结果" autoFocus />
        <div className="mt-3 flex gap-2"><button disabled={mutation.isPending || !answer.trim()} onClick={() => attempt('correct')} className="btn-primary flex-1 px-3 text-sm"><Icon name="check" size={15} />这次答对了</button><button disabled={mutation.isPending || !answer.trim()} onClick={() => attempt('wrong')} className="btn-outline flex-1 px-3 text-sm">这次仍答错</button></div>
        <p className="mt-2.5 text-xs leading-5 text-dim">答对按 1 / 3 / 7 / 16 / 30 天递进复习；答错会回到近期。</p>
      </div>}

      <details className="review-history mt-3 rounded-xl border border-line/70 px-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink2">复习记录{review?.last_reviewed_at ? ` · 最近 ${formatTime(review.last_reviewed_at)}` : ''}</summary>
        {attempts.length > 0 ? <ul className="divide-y divide-line/60 pb-2">{attempts.map((item, index) => <li key={item.id ?? `${item.created_at}-${index}`} className="py-2"><div className="flex flex-wrap justify-between gap-2 text-xs text-ink2"><span>{formatTime(item.created_at)}</span><span className={item.result === 'correct' || item.result === 'mastered' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>{item.action === 'mastered' || item.result === 'mastered' ? '标记掌握' : item.action === 'reopen' || item.result === 'reopened' ? '恢复复习' : item.result === 'correct' ? '答对' : '答错'}</span></div><p className="mt-1 whitespace-pre-wrap">作答：{item.answer || '未填写'}</p></li>)}</ul> : <p className="pb-3 text-xs leading-5 text-ink2">暂无逐次作答明细；汇总：复习 {review?.review_count ?? 0} 次，最近 {formatTime(review?.last_reviewed_at)}。</p>}
      </details>
      {question.explanation?.tips && <div className="mt-3 rounded-xl bg-primary-50/60 p-3 dark:bg-primary-950/25"><span className="flex items-center gap-1 text-xs font-semibold text-primary-800 dark:text-primary-200"><Icon name="sparkles" size={13} />记忆技巧</span><Markdown text={String(question.explanation.tips)} /></div>}
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
  const [exporting, setExporting] = useState(false)
  const studentId = Number(params.get('student_id')) || null
  const paperId = params.get('paper_id') ?? ''
  const reviewParam = params.get('review')
  const review: ReviewFilter = reviewParam === 'pending' || reviewParam === 'mastered' || reviewParam === 'due' ? reviewParam : 'all'
  const days = Number(params.get('days')) || undefined
  const keyword = params.get('q') ?? ''
  const debouncedKeyword = useDebouncedValue(keyword)
  const page = Math.max(0, Number(params.get('page')) || 0)
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(studentId || paperId || days || keyword))
  const extraFilterCount = [studentId, paperId, days, keyword].filter(Boolean).length

  const query = useQuery({
    queryKey: ['mistakes', { studentId, paperId, review, q: debouncedKeyword, days, page }],
    queryFn: ({ signal }) => api.mistakes({ studentId, paperId: paperId || null, review, q: debouncedKeyword, days, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, { signal }),
  })
  const papers = useQuery({ queryKey: ['papers', 'options'], queryFn: ({ signal }) => api.listPapers({ limit: 100 }, { signal }) })
  const groups = query.data?.groups ?? []
  const rows = groups.flatMap((group) => group.questions)
  const total = query.data?.total ?? 0
  const filtered = !!(studentId || paperId || review !== 'all' || days || keyword)

  useEffect(() => {
    const target = emptyPageTarget(page, total, PAGE_SIZE, rows.length)
    if (target === null) return
    setParams((old) => {
      const next = new URLSearchParams(old)
      next.set('page', String(target))
      return next
    })
  }, [page, total, rows.length, setParams])

  function update(key: string, value: string, replace = false) {
    setParams((old) => {
      const next = new URLSearchParams(old)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      return next
    }, { replace })
  }

  async function exportCsv() {
    if (exporting || total === 0) return
    setExporting(true)
    try {
      const result = await api.mistakes({ studentId, paperId: paperId || null, review, q: debouncedKeyword, days, limit: 0, offset: 0 })
      const exportRows = result.groups.flatMap((group) => group.questions)
      const header = ['知识点', '学生', '试卷', '题号', '题干', '上次作答', '标准答案', '复习状态', '复习次数', '连续答对', '下次到期', '原题链接']
      const data = exportRows.map((question) => [
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
      toast(`已导出当前筛选的 ${exportRows.length} 道错题`)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : '导出失败，请重试', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mistakes-page space-y-5">
      <PageHeader
        title="错题复习"
        description="先重新作答，再核对答案。按自己的节奏把错题变成掌握。"
        helpAnchor="mistakes"
        actions={<><button disabled={total === 0 || exporting} onClick={() => void exportCsv()} className="btn-outline flex-1 px-3 sm:flex-none"><Icon name="download" size={15} />{exporting ? '导出中…' : '导出 CSV'}</button><button disabled={rows.length === 0} onClick={() => window.print()} className="btn-outline flex-1 px-3 sm:flex-none"><Icon name="file-text" size={15} />打印</button></>}
      />

      <section className="filter-panel card space-y-3 p-3.5" aria-label="错题筛选">
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="group" aria-label="复习状态">
          {([{ key: 'all', label: '全部' }, { key: 'pending', label: '待复习' }, { key: 'mastered', label: '已掌握' }, { key: 'due', label: '今日到期' }] as const).map((item) => <button key={item.key} aria-pressed={review === item.key} onClick={() => update('review', item.key === 'all' ? '' : item.key)} className={`chip shrink-0 ${review === item.key ? 'chip-active' : ''}`}>{item.label}</button>)}
        </div>
        <button onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-sm font-medium text-ink2 hover:bg-surface-2 sm:hidden">
          <Icon name="filter" size={16} /><span className="flex-1 text-left">更多筛选{extraFilterCount > 0 ? `（已选 ${extraFilterCount} 项）` : ''}</span><Icon name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={15} />
        </button>
        <div className={`${filtersOpen ? 'grid' : 'hidden'} gap-3 border-t border-line/60 pt-3 sm:grid sm:grid-cols-2 sm:border-0 sm:pt-0 lg:grid-cols-4`}>
          <label><span className="mb-1.5 block text-xs font-medium text-ink2">关键词</span><input value={keyword} onChange={(event) => update('q', event.target.value, true)} className="input" placeholder="题干、答案或知识点" /></label>
          <label><span className="mb-1.5 block text-xs font-medium text-ink2">学生</span><StudentFilter value={studentId} onChange={(value) => update('student_id', value ? String(value) : '')} /></label>
          <label><span className="mb-1.5 block text-xs font-medium text-ink2">试卷</span><select value={paperId} onChange={(event) => update('paper_id', event.target.value)} className="input"><option value="">全部试卷</option>{(papers.data?.papers ?? []).map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '试卷'}</option>)}</select></label>
          <label><span className="mb-1.5 block text-xs font-medium text-ink2">批改日期</span><select value={days ?? ''} onChange={(event) => update('days', event.target.value)} className="input"><option value="">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="365">近一年</option></select></label>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3"><p className="text-sm text-ink2" aria-live="polite">共 <b className="font-serif text-lg text-ink">{total}</b> 道错题</p>{filtered && <button onClick={() => setParams({})} className="btn-ghost min-h-9 px-2 text-xs">清空筛选<Icon name="x" size={13} /></button>}</div>
      {query.isPending ? <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-44" />)}</div> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={filtered ? 'target' : 'party-popper'} title={filtered ? '没有符合筛选条件的错题' : '错题本是空的'} description={filtered ? '可清空筛选查看全部错题；已掌握题需切换到“已掌握”查看。' : '完成批改后，答错题会按知识点归集到这里。'} action={filtered ? <button onClick={() => setParams({})} className="btn-outline px-4">清空筛选</button> : undefined} />
      ) : (
        <div data-tour="mistake-list" className="space-y-6">
          {groups.map((group) => <section key={group.knowledge_point} className="mistake-group space-y-3"><h2 className="flex items-center gap-2.5 font-serif text-xl font-bold"><span className="h-4 w-1 rounded-full bg-primary-500" />{group.knowledge_point}<span className="badge bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300">{group.questions.length} 题</span></h2><div className="grid gap-4 xl:grid-cols-2">{group.questions.map((question) => <MistakeCard key={`${question.job_id}-${question.id}`} question={question} />)}</div></section>)}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(value) => setParams((old) => { const next = new URLSearchParams(old); next.set('page', String(value)); return next })} />
    </div>
  )
}
