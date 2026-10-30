import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, pageImageUrl } from '../api'
import { ChatPanel } from '../components/ChatPanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DonutChart } from '../components/DonutChart'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { PaperViewer } from '../components/PaperViewer'
import { QuestionDetail } from '../components/QuestionDetail'
import { QuestionGrid, type QuestionFilter } from '../components/QuestionGrid'
import { Spinner } from '../components/Spinner'
import { StageStepper } from '../components/StageStepper'
import { useToast } from '../components/Toast'
import { FileDropzone, SelectedFileList, UploadProgress } from '../components/UploadPanel'
import { useJobEvents } from '../hooks/useJobEvents'
import { useUploadGuard } from '../hooks/useUploadGuard'
import type { Job, ResourceFile, User } from '../types'
import { compressPicked } from '../utils/compressImage'
import { invalidateLearningData } from '../utils/query'

function StatsBar({ job }: { job: Job }) {
  const stats = job.stats
  const graded = (stats.correct ?? 0) + (stats.wrong ?? 0)
  const items = [
    { label: '答对', value: stats.correct ?? 0, cls: 'text-emerald-700 dark:text-emerald-300' },
    { label: '答错', value: stats.wrong ?? 0, cls: 'text-rose-700 dark:text-rose-300' },
    { label: '待确认', value: stats.unknown ?? 0, cls: 'text-amber-700 dark:text-amber-300' },
    { label: '主观题', value: stats.subjective ?? 0, cls: 'text-violet-700 dark:text-violet-300' },
  ]
  return (
    <section className="card overflow-hidden" aria-label="判分摘要">
      <div className="flex items-center gap-4 p-4 sm:px-6">
        <DonutChart correct={stats.correct ?? 0} total={graded} size={80} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-dim">客观题正确率</p>
          <p className="mt-1 font-serif text-lg font-bold">{graded > 0 ? `${stats.correct ?? 0} / ${graded} 题答对` : '暂无客观题判分'}</p>
          <p className="mt-1 text-xs leading-5 text-dim">{graded > 0 ? '核对答案，再逐题复习' : '待确认与主观题请单独核对'}</p>
        </div>
        {(stats.wrong ?? 0) > 0 && <span className="badge shrink-0 bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300">{stats.wrong} 道错题</span>}
      </div>
      <div className="grid grid-cols-4 divide-x divide-line/60 border-t border-line/70 bg-surface-2/30 py-3">
        {items.map((item) => <div key={item.label} className="text-center"><p className={`font-serif text-xl font-bold ${item.cls}`}>{item.value}</p><p className="mt-0.5 text-[11px] text-ink2">{item.label}</p></div>)}
      </div>
    </section>
  )
}

export function JobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const toast = useToast()
  const user = useOutletContext<User>()
  const isStudent = user.role === 'student'
  const [selectedQid, setSelectedQid] = useState<string | null>(null)
  const [filter, setFilter] = useState<QuestionFilter>('all')
  const [mobileTab, setMobileTab] = useState<'questions' | 'detail' | 'chat'>('questions')
  const [chatQid, setChatQid] = useState<string | null>(null)
  const [showPaper, setShowPaper] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [deletingFile, setDeletingFile] = useState<ResourceFile | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const moreFilesRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const compressionGeneration = useRef(0)
  const deepHandled = useRef<string | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const { sseDown } = useJobEvents(jobId)

  const addFiles = useMutation({
    mutationFn: (variables: { files: File[]; jobId: string; generation: number }) => {
      const controller = new AbortController()
      uploadController.current = controller
      return api.addSubmissionFiles(variables.jobId, variables.files, { signal: controller.signal, onProgress: setUploadPct })
    },
    onSettled: (_data, _error, variables) => {
      if (variables.generation !== compressionGeneration.current) return
      uploadController.current = null
      setUploadPct(null)
    },
    onSuccess: async (_data, variables) => {
      if (variables.generation !== compressionGeneration.current) return
      setPendingFiles([])
      toast('文件已上传，正在重新识别判分')
      await invalidateLearningData(qc)
    },
    onError: (error, variables) => {
      if (error instanceof ApiError && ['abort', 'timeout', 'network'].includes(error.code)) {
        void Promise.all([
          qc.invalidateQueries({ queryKey: ['jobs'] }),
          qc.invalidateQueries({ queryKey: ['job', variables.jobId] }),
        ])
      }
      if (variables.generation !== compressionGeneration.current) return
      toast(error instanceof ApiError ? error.message : '上传失败，请重试', 'error')
    },
  })
  useUploadGuard(addFiles.isPending || picking)

  const retry = useMutation({
    mutationFn: () => api.retryJob(jobId!),
    onSuccess: async () => {
      toast('已使用原文件重新提交识别')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '重试失败', 'error'),
  })
  const accept = useMutation({
    mutationFn: () => api.acceptJobPartial(jobId!),
    onSuccess: async () => {
      setAcceptOpen(false)
      toast('已接受当前不完整结果，请人工核对')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '操作失败', 'error'),
  })
  const delFile = useMutation({
    mutationFn: (fileId: string) => api.deleteJobFile(jobId!, fileId),
    onSuccess: async () => {
      setDeletingFile(null)
      toast('文件已删除，可补传正确文件后重试')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '删除文件失败', 'error'),
  })

  const jobQ = useQuery({
    queryKey: ['job', jobId],
    queryFn: ({ signal }) => api.getJob(jobId!, { signal }),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data
      if (job?.status === 'processing') return sseDown ? 2500 : 5000
      if (job?.sync_pending) return 3000
      if (job?.questions?.some((question) => question.explain_state === 'queued' || question.explain_state === 'generating')) return 3000
      return false
    },
  })

  useEffect(() => {
    compressionGeneration.current += 1
    uploadController.current?.abort()
    uploadController.current = null
    addFiles.reset()
    setPicking(false)
    setPendingFiles([])
    setUploadPct(null)
    setSelectedQid(null)
    setChatQid(null)
    setFilter('all')
    setMobileTab('questions')
    setShowFiles(false)
    deepHandled.current = null
  }, [jobId, setSelectedQid, setFilter, setMobileTab, addFiles.reset])
  useEffect(() => () => {
    compressionGeneration.current += 1
    uploadController.current?.abort()
  }, [])

  const deepQid = searchParams.get('qid')
  useEffect(() => {
    if (!jobId || !deepQid || !jobQ.data?.questions || deepHandled.current === `${jobId}:${deepQid}`) return
    if (jobQ.data.questions.some((question) => question.id === deepQid)) {
      setSelectedQid(deepQid)
      setMobileTab('detail')
      deepHandled.current = `${jobId}:${deepQid}`
    }
  }, [deepQid, jobId, jobQ.data?.questions, setMobileTab, setSelectedQid])

  useEffect(() => {
    const list = jobQ.data?.questions
    if (!list?.length || (deepQid && list.some((question) => question.id === deepQid))) return
    if (selectedQid && list.some((question) => question.id === selectedQid)) return
    const next = list.find((question) => question.status === 'wrong') ?? list.find((question) => question.status === 'unknown') ?? list[0]
    setSelectedQid(next.id)
  }, [deepQid, jobQ.data?.questions, selectedQid])

  if (jobQ.isPending) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>
  if (jobQ.isError) return <div className="mx-auto max-w-xl"><ErrorState error={jobQ.error} onRetry={() => void jobQ.refetch()} /><Link to="/" className="btn-outline mt-4 px-4">返回批改列表</Link></div>

  const job = jobQ.data
  const title = job.paper_title || job.meta?.title || job.filename || '试卷'
  if (job.status === 'processing') {
    return (
      <div className="mx-auto max-w-2xl py-3">
        <Link to="/" className="btn-ghost mb-3 px-2"><Icon name="arrow-left" size={17} />返回批改记录</Link>
        <PageHeader title={title} description="正在识别作答并判分，完成后会自动更新。" helpAnchor="grading" />
        <section className="card mt-6 p-5 sm:p-8" aria-label="批改进度">
          <div className="mb-8 flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950/35 dark:text-primary-300"><Spinner className="h-6 w-6" /></span><div><h2 className="font-serif text-xl font-bold">正在批改这份作业</h2><p className="mt-1 text-xs text-dim">你可以留在本页，也可以稍后回来查看</p></div></div>
          <StageStepper job={job} />
          <p className="mt-8 text-center text-sm leading-6 text-ink2">判分完成后可核对结果，讲解会在后台陆续生成。</p>
        </section>
      </div>
    )
  }

  const questions = job.questions ?? []
  const files = job.files ?? []
  const selected = questions.find((question) => question.id === selectedQid) ?? null
  const selectedIndex = selected ? questions.findIndex((question) => question.id === selected.id) : -1
  const chatQuestion = questions.find((question) => question.id === chatQid) ?? null
  const busy = addFiles.isPending || picking
  const remaining = Math.max(0, 12 - files.length - pendingFiles.length)
  const chatActive = mobileTab === 'chat'

  async function selectFiles(list: FileList | null) {
    if (busy || remaining === 0) return
    const generation = compressionGeneration.current
    setPicking(true)
    try {
      const result = await compressPicked(list, 12, files.length + pendingFiles.length)
      if (generation !== compressionGeneration.current) return
      if (result.dropped > 0) toast(`每份作答最多 12 个文件，已忽略 ${result.dropped} 个`, 'error')
      if (result.files.length) setPendingFiles((old) => [...old, ...result.files])
    } finally {
      if (generation === compressionGeneration.current) setPicking(false)
    }
  }

  function scrollToDetail() {
    if (window.innerWidth >= 1280) return
    requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' }))
  }

  function openQuestion(qid: string) {
    setSelectedQid(qid)
    setMobileTab('detail')
    scrollToDetail()
  }

  function navigateQuestion(offset: number) {
    if (selectedIndex < 0) return
    const next = questions[selectedIndex + offset]
    if (next) openQuestion(next.id)
  }

  function openFilePicker() {
    setShowFiles(true)
    requestAnimationFrame(() => moreFilesRef.current?.click())
  }

  return (
    <div className="space-y-5">
      <div className={chatActive ? 'hidden xl:block' : ''}>
        <Link to="/" className="btn-ghost -ml-2 mb-2 px-2 text-xs"><Icon name="arrow-left" size={16} />批改记录</Link>
        <PageHeader
          title={title}
          helpAnchor="results"
          description={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{job.student_name && <span className="inline-flex items-center gap-1"><Icon name="user" size={13} />{job.student_name}</span>}{job.paper_id && !isStudent && <><span aria-hidden="true">·</span><Link to={`/papers/${job.paper_id}`} className="font-medium text-primary-700 underline underline-offset-4 dark:text-primary-300">查看试卷与答案</Link></>}</span>}
          actions={<>{job.kind === 'submission' && <button onClick={openFilePicker} disabled={busy || remaining === 0} className="btn-outline px-3"><Icon name="camera" size={16} />补拍补传</button>}{!!job.page_count && <button onClick={() => setShowPaper(true)} className="btn-outline px-3"><Icon name="book-open" size={16} />查看原卷</button>}</>}
        />
      </div>

      {job.status === 'error' && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100" role="alert"><p className="font-semibold">处理失败：{job.error || '请重试'}</p><p className="mt-1 text-sm leading-6">无需新建批改，可直接使用原文件重试；若文件损坏，请先删除再补传。</p><button onClick={() => retry.mutate()} disabled={retry.isPending || (job.kind === 'submission' && files.length === 0)} className="btn-primary mt-3 px-4">{retry.isPending ? '正在提交…' : '使用原文件重试'}</button></div>}
      {job.status === 'partial' && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100" role="alert"><p className="font-semibold">部分作答识别完成{job.failed_pages?.length ? `，失败页：${job.failed_pages.join('、')}` : ''}</p><p className="mt-1 text-sm leading-6">以下统计只包含已识别内容。可重试原文件，或明确接受不完整结果后人工核对。</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => retry.mutate()} disabled={retry.isPending} className="btn-outline px-4">重试原文件</button><button onClick={() => setAcceptOpen(true)} className="btn-primary px-4">接受不完整结果</button></div></div>}
      {job.status === 'done' && job.accepted_partial && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">这份结果包含未识别页面{job.failed_pages?.length ? `（${job.failed_pages.join('、')}）` : ''}，正确率和错题汇总可能不完整，请人工核对。</div>}
      {job.sync_pending && <div className="rounded-2xl border border-primary-200 bg-primary-50 p-3 text-sm leading-6 text-primary-900 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-100" role="status">试卷内容已更新，正在后台同步这份作答；当前题目与统计可能暂时不是最新版本。</div>}

      <div className={mobileTab !== 'questions' ? 'hidden xl:block' : ''}><StatsBar job={job} /></div>

      {questions.length === 0 ? (
        <EmptyState icon="file-text" title="还没有可显示的题目" description="请使用原文件重试，或删除坏文件并补拍清晰页面。" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)_320px]">
          <section className={`card p-4 ${mobileTab !== 'questions' ? 'hidden xl:block' : ''}`} aria-label="题目列表">
            <QuestionGrid questions={questions} filter={filter} selectedQid={selectedQid} onFilterChange={setFilter} onSelectQuestion={openQuestion} />
          </section>
          <section ref={detailRef} className={`card scroll-mt-24 p-4 sm:p-5 ${mobileTab !== 'detail' ? 'hidden xl:block' : ''}`} aria-label="题目详情">
            {selected ? (
              <>
                <div className="mb-5 flex items-center justify-between gap-2 border-b border-line/70 pb-3">
                  <button disabled={selectedIndex <= 0} onClick={() => navigateQuestion(-1)} className="btn-ghost px-2 text-xs"><Icon name="arrow-left" size={15} />上一题</button>
                  <span className="badge bg-surface-2 text-ink2">{selectedIndex + 1} / {questions.length}</span>
                  <button disabled={selectedIndex >= questions.length - 1} onClick={() => navigateQuestion(1)} className="btn-ghost px-2 text-xs">下一题<Icon name="arrow-right" size={15} /></button>
                </div>
                <QuestionDetail job={job} question={selected} canEdit={!isStudent} onAsk={() => { setChatQid(selected.id); setMobileTab('chat') }} />
              </>
            ) : <EmptyState icon="grid" title="选择一道题" description="从题目列表选择题号，查看作答、标准答案与讲解。" />}
          </section>
          <section className={`card flex-col p-4 ${mobileTab !== 'chat' ? 'hidden 2xl:flex xl:h-[680px]' : 'flex h-[calc(100dvh-11rem)] min-h-[320px] xl:fixed xl:inset-y-6 xl:right-6 xl:z-40 xl:h-auto xl:w-[390px] 2xl:static 2xl:h-[680px] 2xl:w-auto'}`} aria-label="AI 答疑">
            <button onClick={() => setMobileTab('detail')} className="btn-ghost mb-2 ml-auto hidden min-h-9 px-2 text-xs xl:flex 2xl:hidden"><Icon name="x" size={14} />关闭答疑</button>
            <div className="min-h-0 flex-1"><ChatPanel jobId={job.id} question={chatQuestion} onClearFocus={() => setChatQid(null)} /></div>
          </section>
        </div>
      )}

      <section className={`card overflow-hidden ${mobileTab !== 'questions' ? 'hidden xl:block' : ''}`} aria-labelledby="submission-files-title">
        <button onClick={() => setShowFiles((value) => !value)} aria-expanded={showFiles} className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-surface-2/50">
          <Icon name="folder" size={18} className="text-dim" /><span id="submission-files-title" className="flex-1 text-sm font-semibold">作答文件</span><span className="text-xs text-dim">{files.length} 个已上传 · 还可添加 {remaining} 个</span><Icon name={showFiles ? 'chevron-up' : 'chevron-down'} size={16} className="text-dim" />
        </button>
        <div hidden={!showFiles} className="space-y-4 border-t border-line/70 p-4">
          {files.length > 0 && <ul className="divide-y divide-line/60">{files.map((file) => <li key={file.id} className="flex min-h-12 flex-wrap items-center gap-2 py-2 text-sm"><Icon name="file-text" size={16} className="text-dim" /><span className="min-w-0 flex-1 truncate">{file.filename || '未命名文件'}</span><span className="text-xs text-dim">{file.page_count ? `${file.page_count} 页` : ''}{file.status === 'error' ? ` · ${file.error || '识别失败'}` : ''}</span>{!isStudent && <button disabled={busy} onClick={() => setDeletingFile(file)} className="btn-ghost px-2 text-rose-700 dark:text-rose-300" aria-label={`删除文件 ${file.filename || file.id}`}><Icon name="trash" size={14} /><span aria-hidden="true">删除</span></button>}</li>)}</ul>}
          {job.kind === 'submission' && <FileDropzone inputRef={moreFilesRef} onFiles={(list) => void selectFiles(list)} disabled={busy} picking={picking ? '正在处理照片…' : null} remaining={remaining} limit={12} title="添加作答或补拍文件" browseLabel="选择补拍文件" />}
          {pendingFiles.length > 0 && <><SelectedFileList files={pendingFiles} onRemove={(index) => setPendingFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} disabled={busy} label="待上传文件" /><button disabled={busy} onClick={() => jobId && addFiles.mutate({ files: pendingFiles, jobId, generation: compressionGeneration.current })} className="btn-primary min-h-12 w-full px-4 sm:w-auto">{addFiles.isPending ? '正在上传…' : `上传 ${pendingFiles.length} 个文件`}</button></>}
          {addFiles.isPending && <UploadProgress percent={uploadPct} onCancel={() => uploadController.current?.abort()} />}
        </div>
      </section>

      {chatActive && <button aria-label="关闭答疑" onClick={() => setMobileTab('detail')} className="hidden xl:fixed xl:inset-0 xl:z-30 xl:block xl:bg-black/20 2xl:hidden" />}
      <nav className="mobile-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-surface/95 px-2 pt-1.5 backdrop-blur-xl lg:left-60 xl:hidden" aria-label="结果页栏目">
        {([{ key: 'questions', label: '题目', icon: 'grid' }, { key: 'detail', label: '详情', icon: 'file-text' }, { key: 'chat', label: '答疑', icon: 'chat' }] as const).map((tab) => <button key={tab.key} onClick={() => setMobileTab(tab.key)} aria-current={mobileTab === tab.key ? 'page' : undefined} className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs ${mobileTab === tab.key ? 'font-semibold text-primary-700 dark:text-primary-300' : 'text-dim'}`}><Icon name={tab.icon} size={20} />{tab.label}{mobileTab === tab.key && <span className="absolute top-0 h-0.5 w-6 rounded-full bg-primary-500" />}</button>)}
      </nav>

      {deletingFile && <ConfirmDialog title="删除作答文件" description={`确定删除「${deletingFile.filename || '这个文件'}」吗？相关识别结果可能变化，删除后可补传正确文件并重试。`} pending={delFile.isPending} onClose={() => !delFile.isPending && setDeletingFile(null)} onConfirm={() => delFile.mutate(deletingFile.id)} />}
      {acceptOpen && <ConfirmDialog title="接受不完整批改" description="部分页面未识别，当前正确率和错题汇总并不完整。接受后请人工核对缺页和待确认题。" confirmLabel="明确接受当前结果" pending={accept.isPending} onClose={() => !accept.isPending && setAcceptOpen(false)} onConfirm={() => accept.mutate()} />}
      {showPaper && !!job.page_count && <PaperViewer urlFor={(number) => pageImageUrl(job.id, number)} pageCount={job.page_count} onClose={() => setShowPaper(false)} />}
    </div>
  )
}
