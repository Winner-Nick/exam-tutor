import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { compressPicked } from '../utils/compressImage'
import type { Paper } from '../types'

function PaperStatus({ paper }: { paper: Paper }) {
  if (paper.status === 'processing')
    return (
      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
        {paper.progress?.label || '识别中…'}
      </span>
    )
  if (paper.status === 'error')
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
        识别失败
      </span>
    )
  const missing = paper.question_count - paper.answered_count
  if (paper.question_count > 0 && missing > 0)
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">
        {missing} 题缺答案
      </span>
    )
  return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
      就绪
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
  const [title, setTitle] = useState('')

  const papers = useQuery({
    queryKey: ['papers'],
    queryFn: api.listPapers,
    refetchInterval: (q) =>
      q.state.data?.papers.some((p) => p.status === 'processing') ? 4000 : false,
  })

  const create = useMutation({
    mutationFn: () => api.createPaper(pendingFiles, title.trim() || null),
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
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">📚 录入新试卷</h3>
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
            className="text-sm text-primary-600 hover:underline"
          >
            ✍️ 只有答案？手动录入
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          上传试卷（PDF 或拍照图片，可多选，一次最多 30 个）：含答案、不含答案、甚至只传答案页都可以。答案在另一份文件里？先传题目，进入试卷后再「补传答案文件」。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!!picking}
            className="shrink-0 rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm hover:border-primary-400 disabled:opacity-50 dark:border-slate-700"
          >
            {picking ?? <>📄 选择文件{pendingFiles.length > 0 && `（已选 ${pendingFiles.length} 个）`}</>}
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="试卷名称（可留空自动识别）"
            maxLength={80}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            onClick={() => create.mutate()}
            disabled={pendingFiles.length === 0 || create.isPending}
            className="shrink-0 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {create.isPending ? '上传中…' : '开始识别'}
          </button>
        </div>
        {pendingFiles.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {pendingFiles.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <span className="truncate">{f.name}</span>
                <button
                  onClick={() => setPendingFiles((fs) => fs.filter((_, j) => j !== i))}
                  className="text-slate-300 hover:text-rose-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf,image/*"
          className="hidden"
          onChange={async (e) => {
            setPicking('⏳ 正在处理…')
            try {
              const { files: fs, dropped } = await compressPicked(
                e.target.files, 30, pendingFiles.length,
                (done, total) => setPicking(`⏳ 处理照片 ${done}/${total}…`),
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
        <div className="flex justify-center py-12">
          <Spinner className="h-7 w-7" />
        </div>
      ) : papers.isError ? (
        <p className="py-12 text-center text-slate-400">加载失败，请刷新重试</p>
      ) : papers.data.papers.length === 0 ? (
        <p className="py-12 text-center text-slate-400">试卷库是空的，先录入一份试卷吧</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {papers.data.papers.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/papers/${p.id}`)}
              className="group relative cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-2xl dark:bg-slate-800">
                  {p.status === 'processing' ? <Spinner className="h-5 w-5" /> : '📝'}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold" title={p.title ?? undefined}>
                    {p.title || '试卷'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
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
                    className="absolute top-2.5 right-2.5 rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500 active:bg-rose-50 active:text-rose-500 dark:hover:bg-rose-900/30 dark:active:bg-rose-900/30"
                  >
                    🗑
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
