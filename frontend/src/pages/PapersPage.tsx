import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { FileDropzone, SelectedFileList, UploadProgress } from '../components/UploadPanel'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useIdempotencyKey } from '../hooks/useIdempotencyKey'
import { useUploadGuard } from '../hooks/useUploadGuard'
import type { Paper } from '../types'
import { compressPicked } from '../utils/compressImage'
import { emptyPageTarget } from '../utils/pagination'
import { invalidateCreatedPaper, invalidateLearningData } from '../utils/query'

const PAGE_SIZE = 12

function PaperStatus({ paper }: { paper: Paper }) {
  if (paper.status === 'processing') return <span className="badge bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">{paper.progress?.label || '识别中…'}</span>
  if (paper.status === 'partial') return <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">部分识别，待确认</span>
  if (paper.status === 'error') return <span className="badge bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">识别失败，可重试</span>
  if (paper.accepted_partial) return <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">已接受部分结果</span>
  if (paper.question_count === 0) return <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">待补题</span>
  const missing = paper.question_count - paper.answered_count
  if (missing > 0) return <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{missing} 题缺答案</span>
  return <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Icon name="check" size={12} /> 就绪</span>
}

export function PapersPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [deleting, setDeleting] = useState<Paper | null>(null)
  const [createdPaperId, setCreatedPaperId] = useState<string | null>(null)
  const query = params.get('q') ?? ''
  const debouncedQuery = useDebouncedValue(query)
  const page = Math.max(0, Number(params.get('page')) || 0)
  const { key: idempotencyKey, regenerate: regenerateIdempotencyKey } = useIdempotencyKey([
    pendingFiles, title, subject, grade,
  ])

  const papers = useQuery({
    queryKey: ['papers', { q: debouncedQuery, page }],
    queryFn: ({ signal }) => api.listPapers({ q: debouncedQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, { signal }),
    refetchInterval: (result) => result.state.data?.papers.some((paper) => paper.status === 'processing') ? 4000 : false,
  })

  const create = useMutation({
    mutationFn: (variables: { files: File[]; title: string | null; idempotencyKey: string }) => {
      const controller = new AbortController()
      uploadController.current = controller
      return api.createPaper(
        variables.files, variables.title,
        { signal: controller.signal, onProgress: setUploadPct, idempotencyKey: variables.idempotencyKey },
        { subject, grade },
      )
    },
    onSettled: () => {
      uploadController.current = null
      setUploadPct(null)
    },
    onSuccess: ({ paper_id }) => {
      setPendingFiles([])
      setTitle('')
      regenerateIdempotencyKey()
      setCreatedPaperId(paper_id)
      void invalidateCreatedPaper(qc)
    },
    onError: (error) => {
      toast(error instanceof ApiError ? error.message : '上传失败，请检查网络后重试', 'error')
      if (error instanceof ApiError && ['abort', 'timeout', 'network'].includes(error.code)) {
        void invalidateCreatedPaper(qc)
      }
    },
  })
  useUploadGuard((create.isPending || picking !== null) && !createdPaperId)

  useEffect(() => {
    if (createdPaperId && create.isSuccess) navigate(`/papers/${createdPaperId}`)
  }, [createdPaperId, create.isSuccess, navigate])

  const manual = useMutation({
    mutationFn: api.createManualPaper,
    onSuccess: ({ paper_id }) => {
      setManualOpen(false)
      setManualTitle('')
      void invalidateCreatedPaper(qc)
      navigate(`/papers/${paper_id}`)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '创建失败，请重试', 'error'),
  })

  const del = useMutation({
    mutationFn: api.deletePaper,
    onSuccess: async () => {
      setDeleting(null)
      toast('试卷已删除')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '删除失败，请重试', 'error'),
  })

  useEffect(() => () => uploadController.current?.abort(), [])

  const busy = create.isPending || picking !== null
  const remaining = Math.max(0, 30 - pendingFiles.length)
  const total = papers.data ? papers.data.total ?? papers.data.papers.length : 0

  useEffect(() => {
    const target = emptyPageTarget(page, total, PAGE_SIZE, papers.data?.papers.length)
    if (target === null) return
    setParams((old) => {
      const next = new URLSearchParams(old)
      next.set('page', String(target))
      return next
    })
  }, [page, total, papers.data?.papers.length, setParams])

  async function addFiles(list: FileList | null) {
    if (busy || remaining === 0) return
    setPicking('正在处理…')
    try {
      const result = await compressPicked(list, 30, pendingFiles.length, (done, count) => setPicking(`处理照片 ${done}/${count}…`))
      if (result.dropped > 0) toast(`每份试卷最多 30 个文件，已忽略 ${result.dropped} 个`, 'error')
      if (result.files.length) setPendingFiles((old) => [...old, ...result.files])
    } finally {
      setPicking(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="试卷库" description="录入题目与答案，确认识别完整后再用于批改。" helpAnchor="papers" />

      <section data-tour="paper-upload" className="card overflow-hidden" aria-labelledby="create-paper-title" aria-busy={busy}>
        <div className="flex items-center justify-between gap-3 border-b border-line/70 bg-surface-2/35 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/35 dark:text-primary-300"><Icon name="book" size={20} /></span><div><h2 id="create-paper-title" className="font-serif text-lg font-bold">录入新试卷</h2><p className="mt-0.5 text-xs text-dim">题目与答案只需录入一次</p></div></div>
          <button onClick={() => setManualOpen(true)} disabled={busy} className="btn-ghost shrink-0 px-2.5 text-sm text-primary-700 dark:text-primary-300"><Icon name="edit" size={15} />手动建卷</button>
        </div>
        <div className="p-5 sm:p-6">
          <p className="mb-4 text-sm leading-6 text-ink2">上传 PDF 或照片，含答案、不含答案或只有答案页都可以。</p>
          <FileDropzone inputRef={inputRef} onFiles={(list) => void addFiles(list)} disabled={busy} picking={picking} remaining={remaining} limit={30} title="上传整份试卷" browseLabel="选择试卷文件" />
          {pendingFiles.length > 0 && <div className="mt-4"><SelectedFileList files={pendingFiles} onRemove={(index) => setPendingFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} disabled={busy} label="待上传文件" /></div>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-ink2 sm:col-span-2">试卷名称<input aria-label="试卷名称" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="留空则自动识别（选填）" maxLength={80} className="input mt-1.5" /></label>
            <label className="text-xs font-medium text-ink2">学科（选填）<input value={subject} disabled={busy} onChange={(event) => setSubject(event.target.value)} placeholder="如：英语、数学、物理" maxLength={30} className="input mt-1.5" /></label>
            <label className="text-xs font-medium text-ink2">适用年级（选填）<input value={grade} disabled={busy} onChange={(event) => setGrade(event.target.value)} placeholder="如：初三、五年级" maxLength={30} className="input mt-1.5" /></label>
          </div>
          <button onClick={() => create.mutate({ files: pendingFiles, title: title.trim() || null, idempotencyKey })} disabled={pendingFiles.length === 0 || busy} className="btn-primary mt-5 min-h-12 w-full px-5 text-base">
            {create.isPending ? <><Spinner className="h-4 w-4" />正在提交…</> : <>开始识别<Icon name="arrow-right" size={17} /></>}
          </button>
          {create.isPending && <div className="mt-3"><UploadProgress percent={uploadPct} onCancel={() => uploadController.current?.abort()} /></div>}
          {picking && <p className="sr-only" role="status">正在压缩文件，完成前不能开始识别。</p>}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="paper-library-title">
        <div className="flex items-end justify-between gap-3"><div><h2 id="paper-library-title" className="font-serif text-2xl font-bold">我的试卷</h2><p className="mt-1 text-xs text-dim">核对题目与答案后，即可用于多次批改</p></div>{papers.data && <span className="badge bg-surface-2 text-dim">{total} 份</span>}</div>
        <label className="relative block"><span className="sr-only">搜索试卷</span><Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim" /><input value={query} onChange={(event) => { const { value } = event.target; setParams((old) => { const next = new URLSearchParams(old); if (value) next.set('q', value); else next.delete('q'); next.delete('page'); return next }, { replace: true }) }} className="input pl-10" placeholder="搜索试卷名称" /></label>
        {papers.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-28 rounded-2xl" />)}</div>
        ) : papers.isError ? (
          <ErrorState error={papers.error} onRetry={() => void papers.refetch()} />
        ) : papers.data.papers.length === 0 ? (
          <EmptyState icon="book" title={query ? '没有匹配的试卷' : '试卷库是空的'} description={query ? '试试其他关键词或清空搜索。' : '上传文件或手动建卷，补齐题目后再开始批改。'} action={query ? <button className="btn-outline px-4" onClick={() => setParams({})}>清空搜索</button> : undefined} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {papers.data.papers.map((paper) => (
                <article key={paper.id} className="card card-hover relative">
                  <Link to={`/papers/${paper.id}`} className="block rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 text-primary-600 dark:text-primary-400">{paper.status === 'processing' ? <Spinner className="h-5 w-5" /> : <Icon name="file-text" size={22} />}</span>
                      <div className="min-w-0 flex-1 pr-6">
                        <h2 className="truncate font-semibold" title={paper.title ?? undefined}>{paper.title || '试卷'}</h2>
                        <p className="mt-0.5 text-xs text-ink2">{new Date(paper.created_at * 1000).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} · {paper.question_count} 题{paper.submission_count > 0 && ` · 批改 ${paper.submission_count} 次`}</p>
                        <div className="mt-2"><PaperStatus paper={paper} /></div>
                      </div>
                    </div>
                  </Link>
                  {paper.status !== 'processing' && <button onClick={() => setDeleting(paper)} aria-label={`删除 ${paper.title || '试卷'}`} className="icon-btn absolute top-2 right-2 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"><Icon name="trash" size={16} /></button>}
                </article>
              ))}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(value) => setParams((old) => { const next = new URLSearchParams(old); next.set('page', String(value)); return next })} />
          </>
        )}
      </section>

      {manualOpen && (
        <Dialog title="手动创建试卷" onClose={() => !manual.isPending && setManualOpen(false)} hideClose={manual.isPending} preventClose={manual.isPending}>
          <form onSubmit={(event) => { event.preventDefault(); if (manualTitle.trim()) manual.mutate({ title: manualTitle.trim(), subject, grade }) }} className="space-y-4">
            <p className="text-sm leading-relaxed text-ink2">适合只有答案或需要逐题录入的情况。创建后可继续编辑题干、选项、答案和知识点。</p>
            <label className="block text-sm font-medium text-ink2">试卷名称<input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} maxLength={80} required autoFocus className="input mt-1" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-ink2">学科（选填）<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={30} className="input mt-1" /></label>
              <label className="text-sm font-medium text-ink2">年级（选填）<input value={grade} onChange={(event) => setGrade(event.target.value)} maxLength={30} className="input mt-1" /></label>
            </div>
            {manual.isError && <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">{manual.error instanceof ApiError ? manual.error.message : '创建失败，请重试'}</p>}
            <div className="flex justify-end gap-2"><button type="button" disabled={manual.isPending} onClick={() => setManualOpen(false)} className="btn-ghost px-4">取消</button><button disabled={!manualTitle.trim() || manual.isPending} className="btn-primary px-4">{manual.isPending ? '创建中…' : '创建并录入题目'}</button></div>
          </form>
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog title="删除试卷" description={`确定删除「${deleting.title || '试卷'}」吗？已有 ${deleting.submission_count} 次关联批改。请先在批改记录中核对关联数据；删除后无法恢复。`} pending={del.isPending} onClose={() => !del.isPending && setDeleting(null)} onConfirm={() => del.mutate(deleting.id)} />
      )}
    </div>
  )
}
