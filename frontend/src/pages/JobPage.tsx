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
import { QuestionGrid } from '../components/QuestionGrid'
import { Spinner } from '../components/Spinner'
import { StageStepper } from '../components/StageStepper'
import { useToast } from '../components/Toast'
import { useJobEvents } from '../hooks/useJobEvents'
import { useUploadGuard } from '../hooks/useUploadGuard'
import { useUi } from '../store'
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
    <section className="card p-4 sm:px-6" aria-label="判分摘要">
      <div className="flex items-center gap-4 sm:gap-6">
        <DonutChart correct={stats.correct ?? 0} total={graded} size={72} />
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {items.map((item) => <div key={item.label} className="text-center sm:text-left"><p className={`font-serif text-xl font-bold ${item.cls}`}>{item.value}</p><p className="text-xs text-ink2">{item.label}</p></div>)}
        </div>
      </div>
      {graded === 0 && <p className="mt-2 text-center text-sm text-ink2">未产生客观题正确率；主观题与待确认题请单独核对。</p>}
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
  const { selectedQid, setSelectedQid, mobileTab, setMobileTab, setFilter } = useUi()
  const [chatQid, setChatQid] = useState<string | null>(null)
  const [showPaper, setShowPaper] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [deletingFile, setDeletingFile] = useState<ResourceFile | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const moreFilesRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const compressionGeneration = useRef(0)
  const deepHandled = useRef<string | null>(null)
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

  if (jobQ.isPending) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>
  if (jobQ.isError) return <div className="mx-auto max-w-xl"><ErrorState error={jobQ.error} onRetry={() => void jobQ.refetch()} /><Link to="/" className="btn-outline mt-4 px-4">返回批改列表</Link></div>

  const job = jobQ.data
  const title = job.paper_title || job.meta?.title || job.filename || '试卷'
  if (job.status === 'processing') {
    return <div className="py-16"><PageHeader title={title} helpAnchor="grading" /><div className="mt-10"><StageStepper job={job} /></div><p className="mt-8 text-center text-sm text-ink2">判分完成后可查看结果；讲解会在后台陆续生成。</p></div>
  }

  const questions = job.questions ?? []
  const files = job.files ?? []
  const selected = questions.find((question) => question.id === selectedQid) ?? null
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

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      <div className={chatActive ? 'hidden lg:block' : ''}>
        <PageHeader
          title={title}
          helpAnchor="results"
          description={<>{job.student_name && <span className="inline-flex items-center gap-1"><Icon name="user" size={12} /> {job.student_name}</span>}{job.paper_id && !isStudent && <> · <Link to={`/papers/${job.paper_id}`} className="text-primary-700 underline dark:text-primary-300">查看试卷与答案</Link></>}</>}
          actions={<>{job.kind === 'submission' && <button onClick={() => moreFilesRef.current?.click()} disabled={busy || remaining === 0} className="btn-outline px-3"><Icon name="camera" size={15} /> 补拍补传</button>}{!!job.page_count && <button onClick={() => setShowPaper(true)} className="btn-outline px-3"><Icon name="book-open" size={15} /> 查看原卷</button>}</>}
        />
      </div>

      {job.status === 'error' && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-100" role="alert"><p className="font-semibold">处理失败：{job.error || '请重试'}</p><p className="mt-1 text-sm">无需新建批改，可直接使用原文件重试；若文件损坏，请先删除再补传。</p><button onClick={() => retry.mutate()} disabled={retry.isPending || (job.kind === 'submission' && files.length === 0)} className="btn-primary mt-3 px-4">{retry.isPending ? '正在提交…' : '使用原文件重试'}</button></div>}
      {job.status === 'partial' && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100" role="alert"><p className="font-semibold">部分作答识别完成{job.failed_pages?.length ? `，失败页：${job.failed_pages.join('、')}` : ''}</p><p className="mt-1 text-sm">以下统计只包含已识别内容。可重试原文件，或明确接受不完整结果后人工核对。</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => retry.mutate()} disabled={retry.isPending} className="btn-outline px-4">重试原文件</button><button onClick={() => setAcceptOpen(true)} className="btn-primary px-4">接受不完整结果</button></div></div>}

      {job.status === 'done' && job.accepted_partial && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100" role="status">这份结果包含未识别页面{job.failed_pages?.length ? `（${job.failed_pages.join('、')}）` : ''}，正确率和错题汇总可能不完整，请人工核对。</div>}
      <section className={`card space-y-3 p-4 ${chatActive ? 'hidden lg:block' : ''}`} aria-labelledby="submission-files-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="submission-files-title" className="font-semibold">作答文件</h2><span className="text-xs text-ink2">还可添加 {remaining} 个，共最多 12 个</span></div>
        {files.length > 0 && <ul className="divide-y divide-line/60">{files.map((file) => <li key={file.id} className="flex min-h-11 flex-wrap items-center gap-2 py-2 text-sm"><Icon name="file-text" size={15} className="text-dim" /><span className="min-w-0 flex-1 truncate">{file.filename || '未命名文件'}</span><span className="text-xs text-dim">{file.page_count ? `${file.page_count} 页` : ''}{file.status === 'error' ? ` · ${file.error || '识别失败'}` : ''}</span>{!isStudent && <button disabled={busy} onClick={() => setDeletingFile(file)} className="btn-ghost px-2 text-rose-700 dark:text-rose-300"><Icon name="trash" size={14} /> 删除</button>}</li>)}</ul>}
        <input ref={moreFilesRef} type="file" multiple disabled={busy} accept=".pdf,application/pdf,image/*" className="hidden" onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />
        {job.kind === 'submission' && <button onClick={() => moreFilesRef.current?.click()} disabled={busy || remaining === 0} className="btn-outline border-dashed px-4">{picking ? '正在处理照片…' : '选择补拍文件'}</button>}
        {pendingFiles.length > 0 && <><ul className="flex flex-wrap gap-2">{pendingFiles.map((file, index) => <li key={`${file.name}-${index}`} className="badge min-h-9 bg-surface-2 text-ink2"><span className="max-w-44 truncate">{file.name}</span><button disabled={busy} onClick={() => setPendingFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} className="flex h-8 w-8 items-center justify-center" aria-label={`移除 ${file.name}`}><Icon name="x" size={12} /></button></li>)}</ul><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => jobId && addFiles.mutate({ files: pendingFiles, jobId, generation: compressionGeneration.current })} className="btn-primary px-4">{addFiles.isPending ? uploadPct != null ? `上传中 ${uploadPct}%` : '等待服务器接收…' : `上传 ${pendingFiles.length} 个文件`}</button>{addFiles.isPending && <button onClick={() => uploadController.current?.abort()} className="btn-danger px-4">取消上传</button>}</div></>}
      </section>

      <div className={chatActive ? 'hidden lg:block' : ''}><StatsBar job={job} /></div>

      {questions.length === 0 ? (
        <EmptyState icon="file-text" title="还没有可显示的题目" description="请使用原文件重试，或删除坏文件并补拍清晰页面。" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <section className={`card p-4 ${mobileTab !== 'questions' ? 'hidden lg:block' : ''}`} aria-label="题目列表"><QuestionGrid questions={questions} /></section>
          <section className={`card p-5 ${mobileTab !== 'detail' ? 'hidden lg:block' : ''}`} aria-label="题目详情">
            {selected ? <QuestionDetail job={job} question={selected} canEdit={!isStudent} onAsk={() => { setChatQid(selected.id); setMobileTab('chat') }} /> : <EmptyState icon="grid" title="选择一道题" description="从题目列表选择题号，查看作答、标准答案与讲解。" />}
          </section>
          <section className={`card p-4 lg:h-[640px] ${mobileTab !== 'chat' ? 'hidden lg:block' : 'h-[calc(100dvh-10.5rem)] min-h-[320px]'}`} aria-label="AI 答疑">
            <ChatPanel jobId={job.id} question={chatQuestion} onClearFocus={() => setChatQid(null)} />
          </section>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="结果页栏目">
        {([{ key: 'questions', label: '题目', icon: 'grid' }, { key: 'detail', label: '详情', icon: 'file-text' }, { key: 'chat', label: '答疑', icon: 'chat' }] as const).map((tab) => <button key={tab.key} onClick={() => setMobileTab(tab.key)} aria-current={mobileTab === tab.key ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${mobileTab === tab.key ? 'font-semibold text-primary-700 dark:text-primary-300' : 'text-ink2'}`}><Icon name={tab.icon} size={19} />{tab.label}</button>)}
      </nav>

      {deletingFile && <ConfirmDialog title="删除作答文件" description={`确定删除「${deletingFile.filename || '这个文件'}」吗？相关识别结果可能变化，删除后可补传正确文件并重试。`} pending={delFile.isPending} onClose={() => !delFile.isPending && setDeletingFile(null)} onConfirm={() => delFile.mutate(deletingFile.id)} />}
      {acceptOpen && <ConfirmDialog title="接受不完整批改" description="部分页面未识别，当前正确率和错题汇总并不完整。接受后请人工核对缺页和待确认题。" confirmLabel="明确接受当前结果" pending={accept.isPending} onClose={() => !accept.isPending && setAcceptOpen(false)} onConfirm={() => accept.mutate()} />}
      {showPaper && !!job.page_count && <PaperViewer urlFor={(number) => pageImageUrl(job.id, number)} pageCount={job.page_count} onClose={() => setShowPaper(false)} />}
    </div>
  )
}
