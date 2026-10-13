import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Icon } from '../components/Icon'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { compressPicked } from '../utils/compressImage'
import type { Paper } from '../types'

function PaperStatus({ paper }: { paper: Paper }) {
  if (paper.status === 'processing')
    return (
      <span className="badge bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
        {paper.progress?.label || '识别中…'}
      </span>
    )
  if (paper.status === 'error')
    return (
      <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">识别失败</span>
    )
  const missing = paper.question_count - paper.answered_count
  if (paper.question_count > 0 && missing > 0)
    return (
      <span className="badge bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
        {missing} 题缺答案
      </span>
    )
  return (
    <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
      <Icon name="check" size={12} /> 就绪
    </span>
  )
}

export function PapersPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [title, setTitle] = useState('')

  const papers = useQuery({
    queryKey: ['papers'],
    queryFn: api.listPapers,
    refetchInterval: (q) =>
      q.state.data?.papers.some((p) => p.status === 'processing') ? 4000 : false,
  })

  const create = useMutation({
    mutationFn: () => api.createPaper(pendingFiles, title.trim() || null, setUploadPct),
    onSettled: () => setUploadPct(null),
    onSuccess: ({ paper_id }) => {
      setPendingFiles([])
      setTitle('')
      qc.invalidateQueries({ queryKey: ['papers'] })
      navigate(`/papers/${paper_id}`)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '上传失败，请重试', 'error'),
  })

  const del = useMutation({
    mutationFn: api.deletePaper,
    onSuccess: () => {
      toast('已删除')
      qc.invalidateQueries({ queryKey: ['papers'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '删除失败', 'error'),
  })

  return (
    <div className="space-y-6">
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-title flex items-center gap-2">
            <Icon name="book" size={18} className="text-primary-600 dark:text-primary-400" />
            录入新试卷
          </h3>
          <button
            onClick={async () => {
              const title = prompt('试卷名称（手动录入题号和答案，不上传文件）')
              if (!title?.trim()) return
              try {
                const { paper_id } = await api.createManualPaper(title.trim())
                qc.invalidateQueries({ queryKey: ['papers'] })
                navigate(`/papers/${paper_id}`)
              } catch (e) {
                toast(e instanceof ApiError ? e.message : '创建失败', 'error')
              }
            }}
            className="flex items-center gap-1 text-sm text-primary-600 hover:underline dark:text-primary-400"
          >
            <Icon name="edit" size={14} /> 只有答案？手动录入
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-dim">
          上传试卷（PDF 或拍照图片，可多选，一次最多 30 个）：含答案、不含答案、甚至只传答案页都可以。答案在另一份文件里？先传题目，进入试卷后再「补传答案文件」。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!!picking}
            className="btn-outline shrink-0 border-dashed px-4 py-2.5"
          >
            {picking ? (
              <>
                <Spinner className="h-4 w-4" /> {picking}
              </>
            ) : (
              <>
                <Icon name="upload" size={16} /> 选择文件
                {pendingFiles.length > 0 && `（已选 ${pendingFiles.length} 个）`}
              </>
            )}
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="试卷名称（可留空自动识别）"
            maxLength={80}
            className="input min-w-0 flex-1"
          />
          <button
            onClick={() => create.mutate()}
            disabled={pendingFiles.length === 0 || create.isPending}
            className="btn-primary shrink-0 px-5 py-2.5"
          >
            {create.isPending ? (
              uploadPct != null && uploadPct < 100 ? (
                `上传中 ${uploadPct}%`
              ) : (
                '识别中…'
              )
            ) : (
              '开始识别'
            )}
          </button>
        </div>
        {pendingFiles.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <span key={`${f.name}-${i}`} className="badge bg-surface-2 text-ink2" title={f.name}>
                <Icon name="file-text" size={12} />
                <span className="max-w-36 truncate">{f.name}</span>
                <button
                  onClick={() => setPendingFiles((fs) => fs.filter((_, j) => j !== i))}
                  className="rounded-full p-0.5 hover:text-rose-500"
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf,image/*"
          className="hidden"
          onChange={async (e) => {
            setPicking('正在处理…')
            try {
              const { files: fs, dropped } = await compressPicked(
                e.target.files, 30, pendingFiles.length,
                (done, total) => setPicking(`处理照片 ${done}/${total}…`),
              )
              e.target.value = ''
              if (dropped > 0) toast(`一次最多上传 30 个文件，已忽略 ${dropped} 个`, 'error')
              if (fs.length) setPendingFiles((old) => [...old, ...fs])
            } finally {
              setPicking(null)
            }
          }}
        />
      </div>

      {papers.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
      ) : papers.isError ? (
        <p className="py-12 text-center text-dim">加载失败，请刷新重试</p>
      ) : papers.data.papers.length === 0 ? (
        <div className="card py-14 text-center">
          <Icon name="book" size={32} className="mx-auto text-dim" />
          <p className="mt-3 text-sm text-dim">试卷库是空的，先录入一份试卷吧</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {papers.data.papers.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/papers/${p.id}`)}
              className="card card-hover group relative cursor-pointer p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 text-primary-600 dark:text-primary-400">
                  {p.status === 'processing' ? <Spinner className="h-5 w-5" /> : <Icon name="file-text" size={22} />}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold" title={p.title ?? undefined}>
                    {p.title || '试卷'}
                  </h3>
                  <p className="mt-0.5 text-xs text-dim">
                    {new Date(p.created_at * 1000).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                    {p.question_count > 0 && ` · ${p.question_count} 题`}
                    {p.submission_count > 0 && ` · 批改 ${p.submission_count} 次`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <PaperStatus paper={p} />
                  </div>
                </div>
                {p.status !== 'processing' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm('确定删除这份试卷吗？')) del.mutate(p.id)
                    }}
                    title="删除"
                    className="absolute top-2.5 right-2.5 rounded-lg p-2 text-dim hover:bg-rose-50 hover:text-rose-500 active:bg-rose-50 active:text-rose-500 dark:hover:bg-rose-900/30 dark:active:bg-rose-900/30"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
