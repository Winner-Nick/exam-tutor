import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
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
import { useUploadGuard } from '../hooks/useUploadGuard'
import type { Paper } from '../types'
import { compressPicked } from '../utils/compressImage'
import { invalidateLearningData } from '../utils/query'

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
  const query = params.get('q') ?? ''
  const deferredQuery = useDeferredValue(query)
  const page = Math.max(0, Number(params.get('page')) || 0)

  const papers = useQuery({
    queryKey: ['papers', { q: deferredQuery, page }],
    queryFn: () => api.listPapers({ q: deferredQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    refetchInterval: (result) => result.state.data?.papers.some((paper) => paper.status === 'processing') ? 4000 : false,
  })

  const create = useMutation({
    mutationFn: (variables: { files: File[]; title: string | null }) => {
      const controller = new AbortController()
      uploadController.current = controller
      return api.createPaper(
        variables.files, variables.title, { signal: controller.signal, onProgress: setUploadPct },
        { subject, grade },
      )
    },
    onSettled: () => {
      uploadController.current = null
      setUploadPct(null)
    },
    onSuccess: async ({ paper_id }) => {
      setPendingFiles([])
      setTitle('')
      await invalidateLearningData(qc)
      navigate(`/papers/${paper_id}`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'abort') toast('已取消上传，文件和试卷名称仍保留')
      else toast(error instanceof ApiError ? error.message : '上传失败，请检查网络后重试', 'error')
    },
  })
  useUploadGuard(create.isPending || picking !== null)

  const manual = useMutation({
    mutationFn: api.createManualPaper,
    onSuccess: async ({ paper_id }) => {
      setManualOpen(false)
      setManualTitle('')
      await invalidateLearningData(qc)
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

      <section className="card p-5 sm:p-6" aria-labelledby="create-paper-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="create-paper-title" className="section-title flex items-center gap-2"><Icon name="book" size={18} className="text-primary-600 dark:text-primary-400" /> 录入新试卷</h2>
          <button onClick={() => setManualOpen(true)} disabled={busy} className="btn-ghost px-3 text-sm text-primary-700 dark:text-primary-300"><Icon name="edit" size={14} /> 手动建卷</button>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink2">上传 PDF 或照片，含答案、不含答案或只有答案页都可以。每份试卷最多 30 个文件，本次还可选 {remaining} 个。</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button onClick={() => inputRef.current?.click()} disabled={busy || remaining === 0} className="btn-outline shrink-0 border-dashed px-4">
            {picking ? <><Spinner className="h-4 w-4" /> {picking}</> : <><Icon name="upload" size={16} /> 选择文件{pendingFiles.length > 0 && `（${pendingFiles.length}）`}</>}
          </button>
          <label className="min-w-0 flex-1"><span className="sr-only">试卷名称</span><input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="试卷名称（可留空自动识别）" maxLength={80} className="input" /></label>
          <button onClick={() => create.mutate({ files: pendingFiles, title: title.trim() || null })} disabled={pendingFiles.length === 0 || busy} className="btn-primary shrink-0 px-5">
            {create.isPending ? uploadPct != null && uploadPct < 100 ? `上传中 ${uploadPct}%` : '等待服务器接收…' : '开始识别'}
          </button>
          {create.isPending && <button onClick={() => uploadController.current?.abort()} className="btn-danger px-4">取消</button>}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-ink2">学科（选填）<input value={subject} disabled={busy} onChange={(event) => setSubject(event.target.value)} placeholder="如：英语、数学、物理" maxLength={30} className="input mt-1" /></label>
          <label className="text-xs font-medium text-ink2">适用年级（选填）<input value={grade} disabled={busy} onChange={(event) => setGrade(event.target.value)} placeholder="如：初三、五年级" maxLength={30} className="input mt-1" /></label>
        </div>
        {pendingFiles.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="待上传文件">
            {pendingFiles.map((file, index) => (
              <li key={`${file.name}-${index}`} className="badge min-h-9 bg-surface-2 text-ink2" title={file.name}>
                <Icon name="file-text" size={12} /><span className="max-w-36 truncate">{file.name}</span>
                <button disabled={busy} onClick={() => setPendingFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} className="flex h-8 w-8 items-center justify-center rounded-full hover:text-rose-600" aria-label={`移除 ${file.name}`}><Icon name="x" size={12} /></button>
              </li>
            ))}
          </ul>
        )}
        <input ref={inputRef} type="file" multiple disabled={busy} accept=".pdf,application/pdf,image/*" className="hidden" onChange={(event) => { void addFiles(event.target.files); event.target.value = '' }} />
        {picking && <p className="mt-2 text-sm text-ink2" role="status">正在压缩文件，完成前不能开始识别。</p>}
      </section>

      <section className="space-y-4" aria-label="已有试卷">
        <label className="block max-w-md"><span className="sr-only">搜索试卷</span><input value={query} onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {})} className="input" placeholder="搜索试卷名称" /></label>
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
        <Dialog title="手动创建试卷" onClose={() => !manual.isPending && setManualOpen(false)} hideClose={manual.isPending}>
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
