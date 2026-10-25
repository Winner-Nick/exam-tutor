import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, paperPageImageUrl } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { PaperQuestionDialog } from '../components/PaperQuestionDialog'
import { PaperViewer } from '../components/PaperViewer'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { useUploadGuard } from '../hooks/useUploadGuard'
import type { PaperFile, PaperQuestion } from '../types'
import { compressPicked } from '../utils/compressImage'
import { invalidateLearningData } from '../utils/query'

function AddQuestionRow({ paperId }: { paperId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [number, setNumber] = useState('')
  const [answer, setAnswer] = useState('')
  const [type, setType] = useState('')
  const add = useMutation({
    mutationFn: () => api.addPaperQuestion(paperId, { number: number.trim(), correct_answer: answer.trim() || null, type: type.trim() || null }),
    onSuccess: async () => {
      setNumber('')
      setAnswer('')
      setType('')
      toast('题目已添加')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '添加失败，请重试', 'error'),
  })

  return (
    <form className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-3" onSubmit={(event) => { event.preventDefault(); if (number.trim()) add.mutate() }}>
      <label><span className="sr-only">新题号</span><input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="题号" maxLength={20} className="input w-24" /></label>
      <label><span className="sr-only">新题题型</span><input value={type} onChange={(event) => setType(event.target.value)} placeholder="题型（选填）" maxLength={40} className="input w-32" /></label>
      <label className="min-w-40 flex-1"><span className="sr-only">新题标准答案</span><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="标准答案" maxLength={1000} className="input" /></label>
      <button type="submit" disabled={!number.trim() || add.isPending} className="btn-outline px-3 text-sm"><Icon name="plus" size={14} />{add.isPending ? '添加中…' : '添加题目'}</button>
    </form>
  )
}

export function PaperPage() {
  const { paperId } = useParams<{ paperId: string }>()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const answersRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const compressionGeneration = useRef(0)
  const [showPages, setShowPages] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [editingSubject, setEditingSubject] = useState('')
  const [editingGrade, setEditingGrade] = useState('')
  const [editingQuestion, setEditingQuestion] = useState<PaperQuestion | null>(null)
  const [deletingQuestion, setDeletingQuestion] = useState<PaperQuestion | null>(null)
  const [deletingFile, setDeletingFile] = useState<PaperFile | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)

  const paperQ = useQuery({
    queryKey: ['paper', paperId],
    queryFn: ({ signal }) => api.getPaper(paperId!, { signal }),
    enabled: !!paperId,
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 3000 : false,
  })

  const addAnswers = useMutation({
    mutationFn: (variables: { files: File[]; paperId: string; generation: number }) => {
      const controller = new AbortController()
      uploadController.current = controller
      return api.addPaperFiles(variables.paperId, variables.files, 'answers', { signal: controller.signal, onProgress: setUploadPct })
    },
    onSettled: (_data, _error, variables) => {
      if (variables.generation !== compressionGeneration.current) return
      uploadController.current = null
      setUploadPct(null)
    },
    onSuccess: async (_data, variables) => {
      if (variables.generation !== compressionGeneration.current) return
      setPendingFiles([])
      toast('答案文件已上传，正在重新汇总')
      await invalidateLearningData(qc)
    },
    onError: (error, variables) => {
      if (error instanceof ApiError && ['abort', 'timeout', 'network'].includes(error.code)) {
        void Promise.all([
          qc.invalidateQueries({ queryKey: ['papers'] }),
          qc.invalidateQueries({ queryKey: ['paper', variables.paperId] }),
        ])
      }
      if (variables.generation !== compressionGeneration.current) return
      toast(error instanceof ApiError ? error.message : '上传失败，请重试', 'error')
    },
  })
  useUploadGuard(addAnswers.isPending || picking)

  const retry = useMutation({
    mutationFn: () => api.retryPaper(paperId!),
    onSuccess: async () => {
      toast('已使用原文件重新识别')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '重试失败', 'error'),
  })
  const accept = useMutation({
    mutationFn: () => api.acceptPaperPartial(paperId!),
    onSuccess: async () => {
      setAcceptOpen(false)
      toast('已明确接受不完整试卷，请继续核对题目')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '操作失败', 'error'),
  })
  const rename = useMutation({
    mutationFn: (details: { title: string; subject: string; grade: string }) => api.renamePaper(paperId!, details),
    onSuccess: async () => {
      setEditingTitle(null)
      toast('试卷设置已保存')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '保存失败', 'error'),
  })
  const delQuestion = useMutation({
    mutationFn: (qid: string) => api.deletePaperQuestion(paperId!, qid),
    onSuccess: async () => {
      setDeletingQuestion(null)
      toast('题目已删除')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '删除失败', 'error'),
  })
  const delFile = useMutation({
    mutationFn: (fileId: string) => api.deletePaperFile(paperId!, fileId),
    onSuccess: async () => {
      setDeletingFile(null)
      toast('文件已删除，可重新补传或重试识别')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '删除文件失败', 'error'),
  })
  const knowledge = useMutation({
    mutationFn: () => api.completePaperKnowledgePoints(paperId!),
    onSuccess: async () => {
      toast('知识点补全已提交')
      await invalidateLearningData(qc)
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '知识点补全失败', 'error'),
  })

  useEffect(() => {
    compressionGeneration.current += 1
    uploadController.current?.abort()
    uploadController.current = null
    addAnswers.reset()
    setPicking(false)
    setPendingFiles([])
    setUploadPct(null)
  }, [paperId, addAnswers.reset])
  useEffect(() => () => {
    compressionGeneration.current += 1
    uploadController.current?.abort()
  }, [])

  if (paperQ.isPending) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>
  if (paperQ.isError) return <div className="mx-auto max-w-xl"><ErrorState error={paperQ.error} onRetry={() => void paperQ.refetch()} /><Link to="/papers" className="btn-outline mt-4 px-4">返回试卷库</Link></div>

  const paper = paperQ.data
  const questions = paper.questions ?? []
  const files = paper.files ?? []
  const missing = questions.filter((question) => !question.correct_answer).length
  const busy = addAnswers.isPending || picking
  const remaining = Math.max(0, 30 - files.length - pendingFiles.length)
  const canGrade = paper.status === 'ready' && questions.length > 0

  async function selectFiles(list: FileList | null) {
    if (busy || remaining === 0) return
    const generation = compressionGeneration.current
    setPicking(true)
    try {
      const result = await compressPicked(list, 30, files.length + pendingFiles.length)
      if (generation !== compressionGeneration.current) return
      if (result.dropped > 0) toast(`整份试卷最多 30 个文件，已忽略 ${result.dropped} 个`, 'error')
      if (result.files.length) setPendingFiles((old) => [...old, ...result.files])
    } finally {
      if (generation === compressionGeneration.current) setPicking(false)
    }
  }

  if (paper.status === 'processing') {
    return <div className="py-16 text-center" role="status"><Spinner className="mx-auto h-8 w-8" /><h1 className="mt-4 font-medium">{paper.progress?.label || '正在识别试卷…'}</h1><p className="mt-2 text-sm text-ink2">识别完成后请核对题目与标准答案，再开始批改。</p></div>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={paper.title || '试卷'}
        helpAnchor="papers"
        description={<>{paper.page_count ? `${paper.page_count} 页 · ` : ''}{questions.length} 题{paper.subject ? ` · ${paper.subject}` : ''}{paper.grade ? ` · ${paper.grade}` : ''}{paper.submission_count > 0 && <> · <Link to={`/?paper=${paper.id}#recent-jobs`} className="text-primary-700 underline dark:text-primary-300">查看 {paper.submission_count} 次关联批改</Link></>}</>}
        actions={
          <>
            <button onClick={() => { setEditingTitle(paper.title || ''); setEditingSubject(paper.subject || ''); setEditingGrade(paper.grade || '') }} className="btn-outline px-3"><Icon name="settings" size={15} /> 试卷设置</button>
            {!!paper.page_count && <button onClick={() => setShowPages(true)} className="btn-outline px-3"><Icon name="book-open" size={15} /> 查看原卷</button>}
            {files.length > 0 && <button onClick={() => retry.mutate()} disabled={retry.isPending || busy} className="btn-outline px-3"><Icon name="refresh" size={15} />{retry.isPending ? '提交中…' : '重新识别'}</button>}
            <button onClick={() => answersRef.current?.click()} disabled={busy || remaining === 0} className="btn-outline px-3"><Icon name="upload" size={15} /> 补传答案</button>
            <button disabled={!canGrade} title={!canGrade ? '仅已确认完整且有题目的试卷可用于批改' : undefined} onClick={() => navigate(`/?paper=${paper.id}`)} className="btn-primary px-3"><Icon name="pen" size={15} /> 去批改</button>
          </>
        }
      />

      {paper.status === 'error' && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-100" role="alert">
          <p className="font-semibold">识别失败：{paper.error || '请重试'}</p>
          <button onClick={() => retry.mutate()} disabled={retry.isPending} className="btn-primary mt-3 px-4">{retry.isPending ? '正在提交…' : '使用原文件重试'}</button>
        </div>
      )}
      {paper.status === 'partial' && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100" role="alert">
          <p className="font-semibold">仅识别了部分内容{paper.failed_pages?.length ? `，失败页：${paper.failed_pages.join('、')}` : ''}</p>
          <p className="mt-1 text-sm">当前结果不能用于新提交。可重试原文件，或明确接受不完整结果后继续核对。</p>
          <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => retry.mutate()} disabled={retry.isPending || files.length === 0} className="btn-outline px-4">重试原文件</button>{questions.length > 0 && <button onClick={() => setAcceptOpen(true)} className="btn-primary px-4">接受不完整结果</button>}</div>
        </div>
      )}
      {paper.status === 'ready' && paper.accepted_partial && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100" role="status">已接受不完整识别结果{paper.failed_pages?.length ? `（未识别页：${paper.failed_pages.join('、')}）` : ''}。请继续人工核对；重新识别成功后此标记会移除。</div>}
      {questions.length === 0 && paper.status !== 'error' && <EmptyState icon="file-text" title="这份试卷还没有题目" description="请重试识别、补传正确文件，或在下方手动添加题目；0 题试卷不能用于批改。" action={<button onClick={() => retry.mutate()} disabled={retry.isPending || files.length === 0} className="btn-outline px-4">使用原文件重试</button>} />}
      {missing > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">有 <b>{missing}</b> 题缺少标准答案。可补传答案文件或逐题编辑；缺答案的客观题会标为待确认。</div>}

      <input ref={answersRef} type="file" multiple disabled={busy} accept=".pdf,application/pdf,image/*" className="hidden" onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />
      <section className="card space-y-3 p-4" aria-labelledby="paper-files-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="paper-files-title" className="font-semibold">源文件</h2><span className="text-xs text-ink2">还可添加 {remaining} 个，整卷最多 30 个</span></div>
        {files.length > 0 && <ul className="divide-y divide-line/60">{files.map((file) => <li key={file.id} className="flex min-h-11 flex-wrap items-center gap-2 py-2 text-sm"><Icon name="file-text" size={15} className="text-dim" /><span className="min-w-0 flex-1 truncate">{file.filename || '未命名文件'}</span><span className="text-xs text-dim">{file.page_count ? `${file.page_count} 页` : ''}{file.status === 'error' ? ` · ${file.error || '识别失败'}` : ''}</span><button onClick={() => setDeletingFile(file)} className="btn-ghost px-2 text-rose-700 dark:text-rose-300" aria-label={`删除文件 ${file.filename || file.id}`}><Icon name="trash" size={14} /> 删除</button></li>)}</ul>}
        {pendingFiles.length > 0 && <><ul className="flex flex-wrap gap-2">{pendingFiles.map((file, index) => <li key={`${file.name}-${index}`} className="badge min-h-9 bg-surface-2 text-ink2"><span className="max-w-44 truncate">{file.name}</span><button disabled={busy} onClick={() => setPendingFiles((old) => old.filter((_, itemIndex) => itemIndex !== index))} className="flex h-8 w-8 items-center justify-center" aria-label={`移除 ${file.name}`}><Icon name="x" size={12} /></button></li>)}</ul><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => paperId && addAnswers.mutate({ files: pendingFiles, paperId, generation: compressionGeneration.current })} className="btn-primary px-4">{addAnswers.isPending ? uploadPct != null ? `上传中 ${uploadPct}%` : '等待服务器接收…' : picking ? '正在处理…' : `上传 ${pendingFiles.length} 个答案文件`}</button>{addAnswers.isPending && <button onClick={() => uploadController.current?.abort()} className="btn-danger px-4">取消上传</button>}</div></>}
        {files.length === 0 && pendingFiles.length === 0 && <p className="text-sm text-dim">手动建卷暂无源文件，可直接在下方逐题录入。</p>}
      </section>

      <section className="card overflow-hidden" aria-labelledby="paper-questions-title">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"><h2 id="paper-questions-title" className="font-semibold">题目与答案</h2><button onClick={() => knowledge.mutate()} disabled={knowledge.isPending || questions.length === 0} className="btn-outline px-3 text-sm"><Icon name="sparkles" size={14} />{knowledge.isPending ? '提交中…' : '批量补全知识点'}</button></div>
        {questions.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line text-left text-xs text-ink2"><th className="px-3 py-2.5 font-medium">题号</th><th className="px-3 py-2.5 font-medium">题型 / 知识点</th><th className="px-3 py-2.5 font-medium">题干与选项</th><th className="px-3 py-2.5 font-medium">标准答案</th><th className="px-3 py-2.5 font-medium">操作</th></tr></thead><tbody className="divide-y divide-line/60">{questions.map((question) => <tr key={question.id}><td className="px-3 py-3 font-serif font-semibold">{question.number}</td><td className="max-w-36 px-3 py-3 text-xs text-ink2"><p>{question.type || question.section || '未分类'}</p>{question.knowledge_point && <p className="mt-1 text-dim">{question.knowledge_point}</p>}</td><td className="max-w-md px-3 py-3"><p className="line-clamp-2 whitespace-pre-wrap">{question.stem || '未填写题干'}</p>{question.options && <p className="mt-1 line-clamp-2 text-xs text-dim">{Object.entries(question.options).map(([key, value]) => `${key}.${value}`).join(' ')}</p>}</td><td className="max-w-48 px-3 py-3 whitespace-pre-wrap">{question.correct_answer || <span className="text-amber-700 dark:text-amber-300">未填写</span>}</td><td className="px-3 py-3"><div className="flex gap-1"><button onClick={() => setEditingQuestion(question)} className="btn-ghost px-2 text-primary-700 dark:text-primary-300"><Icon name="edit" size={14} /> 编辑</button><button onClick={() => setDeletingQuestion(question)} className="btn-ghost px-2 text-rose-700 dark:text-rose-300" aria-label={`删除第 ${question.number} 题`}><Icon name="trash" size={14} /></button></div></td></tr>)}</tbody></table></div>}
        <AddQuestionRow paperId={paper.id} />
      </section>
      <p className="text-xs leading-relaxed text-ink2">修改答案或题目内容会按后端结果重判关联作答；请保存后再进入批改或生成新讲解。</p>

      {editingTitle !== null && <Dialog title="试卷设置" onClose={() => !rename.isPending && setEditingTitle(null)} hideClose={rename.isPending} preventClose={rename.isPending}><form onSubmit={(event) => { event.preventDefault(); if (editingTitle.trim()) rename.mutate({ title: editingTitle.trim(), subject: editingSubject.trim(), grade: editingGrade.trim() }) }} className="space-y-4"><label className="block text-sm font-medium text-ink2">试卷名称<input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} autoFocus maxLength={80} required className="input mt-1" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2">学科<input value={editingSubject} onChange={(event) => setEditingSubject(event.target.value)} maxLength={30} placeholder="留空使用通用家教" className="input mt-1" /></label><label className="text-sm font-medium text-ink2">适用年级<input value={editingGrade} onChange={(event) => setEditingGrade(event.target.value)} maxLength={30} placeholder="如：初三" className="input mt-1" /></label></div><p className="text-xs text-ink2">学科与年级会用于 AI 讲解和整卷答疑，不会强制限定为英语。</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingTitle(null)} disabled={rename.isPending} className="btn-ghost px-4">取消</button><button disabled={!editingTitle.trim() || rename.isPending} className="btn-primary px-4">{rename.isPending ? '保存中…' : '保存设置'}</button></div></form></Dialog>}
      {editingQuestion && <PaperQuestionDialog paperId={paper.id} question={editingQuestion} onClose={() => setEditingQuestion(null)} />}
      {deletingQuestion && <ConfirmDialog title="删除题目" description={`确定删除第 ${deletingQuestion.number} 题吗？关联作答和统计会更新，此操作无法撤销。`} pending={delQuestion.isPending} onClose={() => !delQuestion.isPending && setDeletingQuestion(null)} onConfirm={() => delQuestion.mutate(deletingQuestion.id)} />}
      {deletingFile && <ConfirmDialog title="删除源文件" description={`确定删除「${deletingFile.filename || '这个文件'}」吗？删除后可补传正确文件并重试识别。`} pending={delFile.isPending} onClose={() => !delFile.isPending && setDeletingFile(null)} onConfirm={() => delFile.mutate(deletingFile.id)} />}
      {acceptOpen && <ConfirmDialog title="接受不完整试卷" description="部分页面未识别，接受后可能缺少题目或答案。请确认已核对现有内容，并愿意手动补齐；此结果才可用于新批改。" confirmLabel="明确接受并继续核对" pending={accept.isPending} onClose={() => !accept.isPending && setAcceptOpen(false)} onConfirm={() => accept.mutate()} />}
      {showPages && !!paper.page_count && <PaperViewer urlFor={(number) => paperPageImageUrl(paper.id, number)} pageCount={paper.page_count} onClose={() => setShowPages(false)} />}
    </div>
  )
}
