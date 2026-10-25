import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DonutChart } from '../components/DonutChart'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { Spinner } from '../components/Spinner'
import { StudentFilter } from '../components/StudentFilter'
import { useToast } from '../components/Toast'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useIdempotencyKey } from '../hooks/useIdempotencyKey'
import { useUploadGuard } from '../hooks/useUploadGuard'
import type { Job, Paper, User } from '../types'
import { compressPicked } from '../utils/compressImage'
import { emptyPageTarget } from '../utils/pagination'
import { invalidateCreatedSubmission, invalidateLearningData } from '../utils/query'

const PAGE_SIZE = 9

function isUsablePaper(paper: Paper | undefined): paper is Paper {
  return paper?.status === 'ready' && paper.question_count > 0
}

function JobCard({ job, canDelete, onDelete }: { job: Job; canDelete: boolean; onDelete: () => void }) {
  const title = job.paper_title || job.meta?.title || job.filename || '试卷'
  const date = new Date(job.created_at * 1000).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  const stats = job.stats
  const graded = (stats.correct ?? 0) + (stats.wrong ?? 0)
  const finished = job.status === 'done' || job.status === 'partial'

  return (
    <article className="card card-hover relative">
      <Link to={`/jobs/${job.id}`} className="block rounded-2xl p-4 outline-offset-4" aria-label={`查看 ${title} 的批改结果`}>
        <div className="flex items-start gap-3.5">
          {finished ? (
            <DonutChart correct={stats.correct ?? 0} total={graded} size={56} />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
              {job.status === 'processing' ? <Spinner className="h-6 w-6" /> : <Icon name="alert" size={22} className="text-rose-500" />}
            </div>
          )}
          <div className="min-w-0 flex-1 pr-6">
            <h3 className="truncate font-semibold" title={title}>{title}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink2">
              {job.student_name && <><Icon name="user" size={12} /> {job.student_name} ·</>}
              {date}{job.meta?.total_questions ? ` · ${job.meta.total_questions} 题` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {job.status === 'processing' && <span className="badge bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">{job.progress?.label || '处理中…'}</span>}
              {job.status === 'deleting' && <span className="badge bg-surface-2 text-ink2">删除中…</span>}
              {job.status === 'error' && <span className="badge bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">处理失败，可重试</span>}
              {job.status === 'partial' && <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">部分识别，待确认</span>}
              {job.sync_pending && <span className="badge bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">后台同步中</span>}
              {finished && (
                <>
                  {(stats.wrong ?? 0) > 0 && <span className="badge bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">错 {stats.wrong}</span>}
                  {(stats.unknown ?? 0) > 0 && <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">待确认 {stats.unknown}</span>}
                  {job.accepted_partial && <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">含未识别页</span>}
                  {graded === 0 ? (
                    <span className="badge bg-surface-2 text-ink2">未产生客观题正确率</span>
                  ) : (stats.wrong ?? 0) === 0 && (stats.unknown ?? 0) === 0 && (
                    <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Icon name="party-popper" size={12} /> 全对</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Link>
      {canDelete && job.status !== 'processing' && job.status !== 'deleting' && (
        <button onClick={onDelete} aria-label={`删除 ${title}`} className="icon-btn absolute top-2 right-2 z-10 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30">
          <Icon name="trash" size={16} />
        </button>
      )}
    </article>
  )
}

const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 font-serif text-xs font-bold text-white shadow-sm'

export function DashboardPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const user = useOutletContext<User>()
  const isStudent = user.role === 'student'
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)

  const [studentId, setStudentId] = useState<number | null>(null)
  const [paperId, setPaperId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [usePaperFiles, setUsePaperFiles] = useState(false)
  const [deleting, setDeleting] = useState<Job | null>(null)
  const [createdJobId, setCreatedJobId] = useState<string | null>(null)
  const [paperSearch, setPaperSearch] = useState('')

  const recordStudent = Number(params.get('student')) || null
  const recordPaper = params.get('paper') ?? ''
  const recordQuery = params.get('q') ?? ''
  const debouncedRecordQuery = useDebouncedValue(recordQuery)
  const debouncedPaperSearch = useDebouncedValue(paperSearch)
  const page = Math.max(0, Number(params.get('page')) || 0)

  const students = useQuery({ queryKey: ['students'], queryFn: api.listStudents })
  const papers = useQuery({
    queryKey: ['papers', 'options', { q: debouncedPaperSearch }],
    queryFn: ({ signal }) => api.listPapers({ q: debouncedPaperSearch, limit: 200 }, { signal }),
  })
  const jobs = useQuery({
    queryKey: ['jobs', { studentId: recordStudent, paperId: recordPaper, q: debouncedRecordQuery, page }],
    queryFn: ({ signal }) => api.listJobs({ studentId: recordStudent, paperId: recordPaper || null, q: debouncedRecordQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, { signal }),
    refetchInterval: (query) => query.state.data?.jobs.some((job) => job.status === 'processing' || job.sync_pending) ? 4000 : false,
  })

  const readyPapers = (papers.data?.papers ?? []).filter(isUsablePaper)
  const listedPaper = paperId ? papers.data?.papers.find((paper) => paper.id === paperId) : undefined
  const selectedPaperQuery = useQuery({
    queryKey: ['paper', paperId],
    queryFn: ({ signal }) => api.getPaper(paperId, { signal }),
    enabled: !!paperId && !listedPaper,
  })
  const detailedPaper = selectedPaperQuery.data?.id === paperId ? selectedPaperQuery.data : undefined
  const selectedPaper = listedPaper
    ? isUsablePaper(listedPaper) ? listedPaper : undefined
    : isUsablePaper(detailedPaper) ? detailedPaper : undefined
  const selectablePapers = selectedPaper && !readyPapers.some((paper) => paper.id === selectedPaper.id)
    ? [selectedPaper, ...readyPapers]
    : readyPapers
  const { key: idempotencyKey, regenerate: regenerateIdempotencyKey } = useIdempotencyKey([
    paperId, studentId, files, usePaperFiles,
  ])

  useEffect(() => {
    if (studentId == null && students.data) {
      const hit = students.data.students.find((student) => student.id === recordStudent)
      setStudentId(hit?.id ?? students.data.students.find((student) => student.is_self)?.id ?? students.data.students[0]?.id ?? null)
    }
  }, [students.data, studentId, recordStudent])
  useEffect(() => {
    if (recordPaper) setPaperId(recordPaper)
  }, [recordPaper])
  useEffect(() => {
    if (!paperId) return
    const invalidListed = !!listedPaper && !isUsablePaper(listedPaper)
    const invalidDetail = !!detailedPaper && !isUsablePaper(detailedPaper)
    if (invalidListed || invalidDetail || (selectedPaperQuery.isError && !listedPaper)) {
      setPaperId('')
      setUsePaperFiles(false)
    }
  }, [paperId, listedPaper, detailedPaper, selectedPaperQuery.isError])
  useEffect(() => () => uploadController.current?.abort(), [])

  const submit = useMutation({
    mutationFn: (variables: { paperId: string; studentId: number; files: File[]; usePaperFiles: boolean; idempotencyKey: string }) => {
      const controller = new AbortController()
      uploadController.current = controller
      return api.createSubmission(variables.paperId, variables.studentId, variables.files, variables.usePaperFiles, {
        signal: controller.signal,
        onProgress: setUploadPct,
        idempotencyKey: variables.idempotencyKey,
      })
    },
    onSettled: () => {
      uploadController.current = null
      setUploadPct(null)
    },
    onSuccess: ({ job_id }) => {
      setFiles([])
      setUsePaperFiles(false)
      regenerateIdempotencyKey()
      setCreatedJobId(job_id)
      void invalidateCreatedSubmission(qc)
    },
    onError: (error) => {
      toast(error instanceof ApiError ? error.message : '提交失败，请检查网络后重试', 'error')
      if (error instanceof ApiError && ['abort', 'timeout', 'network'].includes(error.code)) {
        void invalidateCreatedSubmission(qc)
      }
    },
  })

  useEffect(() => {
    if (createdJobId && submit.isSuccess) navigate(`/jobs/${createdJobId}`)
  }, [createdJobId, submit.isSuccess, navigate])

  useUploadGuard((submit.isPending || picking !== null) && !createdJobId)

  const del = useMutation({
    mutationFn: api.deleteJob,
    onSuccess: async () => {
      setDeleting(null)
      toast('批改记录已删除')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '删除失败，请重试', 'error'),
  })

  const busy = submit.isPending || picking !== null
  const canReusePaperFiles = !!selectedPaper?.page_count
  const remaining = Math.max(0, 12 - files.length)
  const canSubmit = !!selectedPaper && studentId != null && ((usePaperFiles && canReusePaperFiles) || files.length > 0) && !busy

  async function addFiles(list: FileList | null) {
    if (busy || remaining === 0) return
    setPicking('正在处理…')
    try {
      const result = await compressPicked(list, 12, files.length, (done, total) => setPicking(`处理照片 ${done}/${total}…`))
      if (result.dropped > 0) toast(`最多上传 12 个文件，已忽略 ${result.dropped} 个`, 'error')
      if (result.files.length) setFiles((old) => [...old, ...result.files])
    } finally {
      setPicking(null)
    }
  }

  function updateFilter(key: string, value: string, replace = false) {
    setParams((old) => {
      const next = new URLSearchParams(old)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      return next
    }, { replace })
  }

  const total = jobs.data ? jobs.data.total ?? jobs.data.jobs.length : 0
  const filtered = !!(recordStudent || recordPaper || recordQuery)

  useEffect(() => {
    const target = emptyPageTarget(page, total, PAGE_SIZE, jobs.data?.jobs.length)
    if (target === null) return
    setParams((old) => {
      const next = new URLSearchParams(old)
      next.set('page', String(target))
      return next
    })
  }, [page, total, jobs.data?.jobs.length, setParams])

  return (
    <div className="space-y-6">
      <PageHeader title={isStudent ? '我的批改' : '拍照批改'} description="上传清晰作答，先确认识别与判分，再结合讲解复习。" helpAnchor="grading" />

      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="new-submission-title">
        <h2 id="new-submission-title" className="section-title flex items-center gap-2"><Icon name="pen" size={18} className="text-primary-600 dark:text-primary-400" />{isStudent ? '上传我的作答' : '批改新作业'}</h2>

        {!isStudent && (
          <div>
            <p className="mb-2.5 flex items-center gap-2 text-sm font-medium"><span className={stepBadge}>1</span> 谁做的题？</p>
            {students.isPending ? <div className="skeleton h-11 w-48" /> : students.isError ? (
              <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">学生列表加载失败 <button onClick={() => void students.refetch()} className="ml-2 underline">重试</button></p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {(students.data?.students ?? []).map((student) => (
                  <button key={student.id} disabled={busy} onClick={() => setStudentId(student.id)} aria-pressed={studentId === student.id} className={`chip ${studentId === student.id ? 'chip-active' : ''}`}>
                    <Icon name="user" size={14} />{student.is_self ? '我自己' : student.name}
                  </button>
                ))}
                <Link to="/students" className="flex min-h-11 items-center gap-0.5 text-sm text-primary-700 hover:underline dark:text-primary-300"><Icon name="plus" size={14} /> 管理学生</Link>
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-2.5 flex items-center gap-2 text-sm font-medium"><span className={stepBadge}>{isStudent ? 1 : 2}</span> 做的哪份题？</p>
          <label className="mb-2 block max-w-md"><span className="sr-only">搜索可选试卷</span><input value={paperSearch} onChange={(event) => setPaperSearch(event.target.value)} className="input" placeholder="搜索可选试卷名称" /></label>
          {papers.isPending && !selectedPaper ? <div className="skeleton h-11 max-w-md" /> : papers.isError && !selectedPaper ? (
            <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">试卷列表加载失败 <button onClick={() => void papers.refetch()} className="ml-2 underline">重试</button></p>
          ) : selectablePapers.length === 0 && !paperId ? (
            <p className="text-sm text-ink2">{paperSearch ? '没有匹配的可用试卷，请更换关键词。' : isStudent ? '还没有可用试卷，请告诉老师先录入并核对题目。' : <>还没有可用试卷，请先 <Link to="/papers" className="text-primary-700 underline dark:text-primary-300">录入试卷并补齐题目</Link>。部分识别试卷需先明确接受。</>}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="min-w-0 max-w-full flex-1 sm:max-w-md">
                <span className="sr-only">选择试卷</span>
                <select value={paperId} disabled={busy} onChange={(event) => setPaperId(event.target.value)} className="input cursor-pointer">
                  <option value="">— 选择试卷 —</option>
                  {paperId && !selectedPaper && <option value={paperId}>正在核对所选试卷…</option>}
                  {selectablePapers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '试卷'}（{paper.question_count} 题{paper.question_count - paper.answered_count > 0 ? `，${paper.question_count - paper.answered_count} 题缺答案` : ''}）</option>)}
                </select>
              </label>
              {!isStudent && <Link to="/papers" className="flex min-h-11 items-center gap-0.5 text-sm text-primary-700 hover:underline dark:text-primary-300"><Icon name="plus" size={14} /> 新试卷</Link>}
            </div>
          )}
        </div>

        <fieldset disabled={busy} className="min-w-0">
          <legend className="mb-2.5 flex flex-wrap items-center gap-2 text-sm font-medium"><span className={stepBadge}>{isStudent ? 2 : 3}</span> 上传做题结果</legend>
          <p className="mb-2 text-xs text-ink2">本次还可选择 {remaining} 个文件，共最多 12 个；之后可在结果页补拍。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={usePaperFiles || remaining === 0} className="btn-outline border-dashed px-4"><Icon name="camera" size={16} /> 拍照</button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={usePaperFiles || remaining === 0} className="btn-outline border-dashed px-4">
              {picking ? <><Spinner className="h-4 w-4" /> {picking}</> : <><Icon name="image" size={16} /> 相册 / 文件</>}
            </button>
            {!isStudent && canReusePaperFiles && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink2">
                <input type="checkbox" checked={usePaperFiles} onChange={(event) => setUsePaperFiles(event.target.checked)} className="h-5 w-5 accent-primary-600" />
                复用试卷扫描件作为学生作答
              </label>
            )}
          </div>
          {files.length > 0 && !usePaperFiles && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="已选文件">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="badge min-h-9 bg-surface-2 text-ink2" title={file.name}>
                  <Icon name="file-text" size={12} /><span className="max-w-36 truncate">{file.name}</span>
                  <button type="button" onClick={() => setFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} className="flex h-8 w-8 items-center justify-center rounded-full hover:text-rose-600" aria-label={`移除 ${file.name}`}><Icon name="x" size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { void addFiles(event.target.files); event.target.value = '' }} />
          <input ref={fileRef} type="file" multiple accept=".pdf,application/pdf,image/*" className="hidden" onChange={(event) => { void addFiles(event.target.files); event.target.value = '' }} />
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selectedPaper && studentId != null && submit.mutate({ paperId: selectedPaper.id, studentId, files, usePaperFiles, idempotencyKey })}
            disabled={!canSubmit}
            className="btn-primary min-w-40 px-8 text-base"
          >
            {submit.isPending ? uploadPct != null && uploadPct < 100 ? <><Icon name="upload" size={17} /> 上传中 {uploadPct}%</> : <><Spinner className="h-4 w-4 text-white" /> 等待服务器接收…</> : isStudent ? '提交批改' : '开始批改'}
          </button>
          {submit.isPending && <button onClick={() => uploadController.current?.abort()} className="btn-danger px-4">取消上传</button>}
        </div>
        {picking && <p className="text-sm text-ink2" role="status">正在压缩文件，完成前不能提交。</p>}
      </section>

      <section id="recent-jobs" className="space-y-4" aria-labelledby="recent-jobs-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-jobs-title" className="font-serif text-2xl font-bold text-ink">最近批改</h2>
          <Link to="/guide#grading" className="text-sm text-primary-700 hover:underline dark:text-primary-300">查看批改帮助</Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label><span className="sr-only">搜索批改记录</span><input value={recordQuery} onChange={(event) => updateFilter('q', event.target.value, true)} className="input" placeholder="搜索试卷或记录" /></label>
          <StudentFilter value={recordStudent} onChange={(value) => updateFilter('student', value ? String(value) : '')} />
          <label><span className="sr-only">按试卷筛选</span><select value={recordPaper} onChange={(event) => updateFilter('paper', event.target.value)} className="input w-full sm:w-44">
            <option value="">全部试卷</option>
            {(papers.data?.papers ?? []).map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '试卷'}</option>)}
          </select></label>
        </div>
        {jobs.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-28 rounded-2xl" />)}</div>
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
        ) : jobs.data.jobs.length === 0 ? (
          <EmptyState icon="pen" title={filtered ? '没有符合筛选条件的批改记录' : '还没有批改记录'} description={filtered ? '可清空搜索或更换学生、试卷筛选。' : '从上面的步骤开始第一次批改。'} action={filtered ? <button className="btn-outline px-4" onClick={() => setParams({})}>清空筛选</button> : undefined} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.data.jobs.map((job) => <JobCard key={job.id} job={job} canDelete={!isStudent} onDelete={() => setDeleting(job)} />)}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(value) => setParams((old) => { const next = new URLSearchParams(old); next.set('page', String(value)); return next })} />
          </>
        )}
      </section>

      {deleting && (
        <ConfirmDialog
          title="删除批改记录"
          description={`确定删除「${deleting.paper_title || deleting.meta?.title || '这份作业'}」吗？相关题目、讲解和复习记录也会受影响，此操作无法撤销。`}
          pending={del.isPending}
          onClose={() => !del.isPending && setDeleting(null)}
          onConfirm={() => del.mutate(deleting.id)}
        />
      )}
    </div>
  )
}
