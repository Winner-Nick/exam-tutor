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
import { FileDropzone, SelectedFileList, UploadProgress } from '../components/UploadPanel'
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

  useEffect(() => {
    if (!canReusePaperFiles) setUsePaperFiles(false)
  }, [canReusePaperFiles])

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
    <div className="space-y-7">
      <PageHeader
        title={isStudent ? '我的批改' : '拍照批改'}
        description="选好试卷，上传清晰作答，剩下的交给错题小方。"
        helpAnchor="grading"
        actions={<Link to={isStudent ? '/mistakes' : '/papers'} className="btn-outline px-4"><Icon name={isStudent ? 'bookmark' : 'book'} size={16} />{isStudent ? '复习错题' : '管理试卷'}</Link>}
      />

      <section data-tour="submission-form" className="card overflow-hidden" aria-labelledby="new-submission-title" aria-busy={busy}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-gradient-to-r from-primary-50/80 to-surface px-5 py-5 sm:px-6 dark:from-primary-950/30">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-sm"><Icon name="pen" size={21} /></span>
            <div><h2 id="new-submission-title" className="font-serif text-xl font-bold">{isStudent ? '上传我的作答' : '开始一次新批改'}</h2><p className="mt-0.5 text-xs text-dim">按步骤选择，提交前可随时修改</p></div>
          </div>
          <span className="badge bg-surface text-dim shadow-sm"><Icon name="check-circle" size={13} />三步完成</span>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="space-y-7 p-5 sm:p-6">
            {!isStudent && (
              <section data-tour="students" aria-label="选择学生">
                <div className="mb-3 flex items-center gap-2.5"><span className={stepBadge}>1</span><div><h3 className="text-sm font-semibold">这是谁的作业？</h3><p className="mt-0.5 text-xs text-dim">错题和统计会归入对应学生</p></div></div>
                {students.isPending ? <div className="skeleton h-11 w-56" /> : students.isError ? (
                  <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" role="alert">学生列表加载失败 <button onClick={() => void students.refetch()} className="ml-2 min-h-9 font-semibold underline">重试</button></p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {(students.data?.students ?? []).map((student) => (
                      <button key={student.id} disabled={busy} onClick={() => setStudentId(student.id)} aria-pressed={studentId === student.id} className={`chip ${studentId === student.id ? 'chip-active' : ''}`}>
                        <Icon name="user" size={14} />{student.is_self ? '我自己' : student.name}{studentId === student.id && <Icon name="check" size={13} />}
                      </button>
                    ))}
                    <Link to="/students" className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30"><Icon name="plus" size={14} />管理学生</Link>
                  </div>
                )}
              </section>
            )}

            <section aria-label="选择试卷">
              <div className="mb-3 flex items-center gap-2.5"><span className={stepBadge}>{isStudent ? 1 : 2}</span><div><h3 className="text-sm font-semibold">做的是哪份试卷？</h3><p className="mt-0.5 text-xs text-dim">仅显示已就绪、可用于批改的试卷</p></div></div>
              <label className="relative mb-2.5 block"><span className="sr-only">搜索可选试卷</span><Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim" /><input value={paperSearch} onChange={(event) => setPaperSearch(event.target.value)} className="input pl-10" placeholder="搜索试卷名称" /></label>
              {papers.isPending && !selectedPaper ? <div className="skeleton h-11 w-full" /> : papers.isError && !selectedPaper ? (
                <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" role="alert">试卷列表加载失败 <button onClick={() => void papers.refetch()} className="ml-2 min-h-9 font-semibold underline">重试</button></p>
              ) : selectablePapers.length === 0 && !paperId ? (
                <div className="subtle-panel p-3.5 text-sm leading-6 text-ink2">{paperSearch ? '没有匹配的可用试卷，请更换关键词。' : isStudent ? '还没有可用试卷，请告诉老师先录入并核对题目。' : <>还没有可用试卷，请先 <Link to="/papers" className="font-medium text-primary-700 underline underline-offset-4 dark:text-primary-300">录入试卷并补齐题目</Link>。</>}</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-w-0 flex-1"><span className="sr-only">选择试卷</span><select data-tour="paper-select" value={paperId} disabled={busy} onChange={(event) => setPaperId(event.target.value)} className="input cursor-pointer">
                      <option value="">请选择试卷</option>
                      {paperId && !selectedPaper && <option value={paperId}>正在核对所选试卷…</option>}
                      {selectablePapers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '试卷'}（{paper.question_count} 题{paper.question_count - paper.answered_count > 0 ? `，${paper.question_count - paper.answered_count} 题缺答案` : ''}）</option>)}
                    </select></label>
                    {!isStudent && <Link to="/papers" aria-label="新建试卷" className="icon-btn border border-line bg-surface"><Icon name="plus" size={17} /></Link>}
                  </div>
                  {selectedPaper && <div className="mt-3 flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/60 p-3 dark:border-primary-900/50 dark:bg-primary-950/25"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-primary-600 dark:text-primary-300"><Icon name="book-open" size={18} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{selectedPaper.title || '试卷'}</p><p className="mt-0.5 text-xs text-dim">{selectedPaper.question_count} 道题{selectedPaper.question_count - selectedPaper.answered_count > 0 ? ` · ${selectedPaper.question_count - selectedPaper.answered_count} 题缺答案，需核对` : ' · 答案已配置'}</p></div><Icon name="check-circle" size={18} className="shrink-0 text-emerald-600" /></div>}
                </>
              )}
            </section>
          </div>

          <section data-tour="submission-upload" className="border-t border-line/70 p-5 sm:p-6 xl:border-t-0 xl:border-l" aria-label="上传做题结果">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5"><span className={stepBadge}>{isStudent ? 2 : 3}</span><div><h3 className="text-sm font-semibold">上传做题结果</h3><p className="mt-0.5 text-xs text-dim">照片尽量平整、清晰、无阴影</p></div></div>
              <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || usePaperFiles || remaining === 0} className="btn-outline shrink-0 px-3"><Icon name="camera" size={16} />拍照</button>
            </div>
            <fieldset disabled={busy} className="mt-4 min-w-0">
              <FileDropzone inputRef={fileRef} onFiles={(list) => void addFiles(list)} disabled={usePaperFiles} picking={picking} remaining={remaining} limit={12} title="把作答照片放在这里" description={<>支持 JPG、PNG、WebP、HEIC 和 PDF</>} browseLabel="从相册或文件选择" />
              {!isStudent && canReusePaperFiles && (
                <label className="mt-3 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl bg-surface-2/60 p-3 text-sm text-ink2">
                  <input type="checkbox" checked={usePaperFiles} onChange={(event) => setUsePaperFiles(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary-600" />
                  <span><span className="block font-medium text-ink">复用试卷扫描件作为作答</span><span className="mt-0.5 block text-xs text-dim">仅当源文件本身就是这份学生的作答时使用</span></span>
                </label>
              )}
              {usePaperFiles ? <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><Icon name="check-circle" size={17} />将使用试卷的 {selectedPaper?.page_count} 页扫描件进行批改</p> : <SelectedFileList files={files} onRemove={(index) => setFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} />}
            </fieldset>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { void addFiles(event.target.files); event.target.value = '' }} />
            {files.length > 0 && !usePaperFiles && <p className="mt-2 text-xs text-dim">已选择 {files.length} 个文件，提交后还可在结果页补拍。</p>}
            {picking && <p className="sr-only" role="status">正在压缩文件，完成前不能提交。</p>}
          </section>
        </div>

        <div className="border-t border-line/70 bg-surface-2/30 p-4 sm:px-6">
          <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs leading-5 text-dim" aria-live="polite">{!selectedPaper ? '选择试卷后即可继续' : studentId == null ? '请选择这份作业对应的学生' : !usePaperFiles && files.length === 0 ? '再添加至少一个作答文件，就可以开始批改' : `已选好「${selectedPaper.title || '试卷'}」，提交后将自动识别并判分。`}</p>
            <button onClick={() => selectedPaper && studentId != null && submit.mutate({ paperId: selectedPaper.id, studentId, files, usePaperFiles, idempotencyKey })} disabled={!canSubmit} className="btn-primary min-h-12 shrink-0 px-7 text-base">
              {submit.isPending ? <><Spinner className="h-4 w-4" />正在提交…</> : <>{isStudent ? '提交批改' : '开始批改'}<Icon name="arrow-right" size={17} /></>}
            </button>
          </div>
          {submit.isPending && <div className="mt-3"><UploadProgress percent={uploadPct} onCancel={() => uploadController.current?.abort()} /></div>}
        </div>
      </section>

      <section id="recent-jobs" data-tour="recent-jobs" className="scroll-mt-24 space-y-4" aria-labelledby="recent-jobs-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="flex items-center gap-2.5"><h2 id="recent-jobs-title" className="font-serif text-2xl font-bold text-ink">最近批改</h2>{!jobs.isPending && <span className="badge bg-surface-2 text-dim">{total} 次</span>}</div><p className="mt-1 text-xs text-dim">点击记录可核对答案、查看讲解或继续答疑</p></div>
          <Link to="/guide#grading" className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30">查看批改帮助<Icon name="arrow-up-right" size={14} /></Link>
        </div>
        <div className="subtle-panel grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative block"><span className="sr-only">搜索批改记录</span><Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim" /><input value={recordQuery} onChange={(event) => updateFilter('q', event.target.value, true)} className="input pl-10" placeholder="搜索试卷或记录" /></label>
          <StudentFilter value={recordStudent} onChange={(value) => updateFilter('student', value ? String(value) : '')} />
          <label><span className="sr-only">按试卷筛选</span><select value={recordPaper} onChange={(event) => updateFilter('paper', event.target.value)} className="input w-full lg:w-48">
            <option value="">全部试卷</option>
            {(papers.data?.papers ?? []).map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '试卷'}</option>)}
          </select></label>
        </div>
        {jobs.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-32" />)}</div>
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
