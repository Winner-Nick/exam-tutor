import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, paperPageImageUrl } from '../api'
import { Icon } from '../components/Icon'
import { PaperViewer } from '../components/PaperViewer'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { compressPicked } from '../utils/compressImage'
import type { Paper, PaperQuestion } from '../types'

function AnswerCell({ paper, q }: { paper: Paper; q: PaperQuestion }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [value, setValue] = useState(q.correct_answer ?? '')

  // 外部变化（重判、补传识别）后同步输入框，避免停留在旧值
  const serverValue = q.correct_answer ?? ''
  useEffect(() => {
    setValue(serverValue)
  }, [q.id, serverValue])

  const save = useMutation({
    mutationFn: () => api.setPaperAnswer(paper.id, q.id, value.trim() || null),
    onSuccess: ({ regraded }) => {
      qc.invalidateQueries({ queryKey: ['paper', paper.id] })
      if (regraded > 0) toast(`已保存，并重判了 ${regraded} 份作答`)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '保存失败', 'error'),
  })

  const dirty = value.trim() !== (q.correct_answer ?? '')
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => dirty && save.mutate()}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      placeholder="—"
      className={`w-full min-w-16 rounded-lg border px-2 py-1 text-sm transition-colors outline-none focus:border-primary-400 ${
        q.correct_answer
          ? 'border-line bg-surface'
          : 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-900/20'
      }`}
    />
  )
}

function AddQuestionRow({ paperId }: { paperId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [number, setNumber] = useState('')
  const [answer, setAnswer] = useState('')

  const add = useMutation({
    mutationFn: () =>
      api.addPaperQuestion(paperId, { number: number.trim(), correct_answer: answer.trim() || null }),
    onSuccess: () => {
      setNumber('')
      setAnswer('')
      qc.invalidateQueries({ queryKey: ['paper', paperId] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '添加失败', 'error'),
  })

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (number.trim()) add.mutate()
      }}
    >
      <input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="题号"
        maxLength={10}
        className="input w-16 px-2 py-1"
      />
      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="标准答案"
        maxLength={100}
        className="input w-36 px-2 py-1"
      />
      <button
        type="submit"
        disabled={!number.trim() || add.isPending}
        className="btn-outline rounded-lg px-3 py-1 text-sm"
      >
        <Icon name="plus" size={14} /> 添加题目
      </button>
      <span className="text-xs text-dim">识别漏了题，或只有答案没有卷子时手动录入</span>
    </form>
  )
}

export function PaperPage() {
  const { paperId } = useParams<{ paperId: string }>()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const answersRef = useRef<HTMLInputElement>(null)
  const [showPages, setShowPages] = useState(false)
  const [picking, setPicking] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState<string | null>(null)

  const paperQ = useQuery({
    queryKey: ['paper', paperId],
    queryFn: () => api.getPaper(paperId!),
    enabled: !!paperId,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 3000 : false),
  })

  const addAnswers = useMutation({
    mutationFn: (files: File[]) => api.addPaperFiles(paperId!, files, 'answers', setUploadPct),
    onSettled: () => setUploadPct(null),
    onSuccess: () => {
      toast('答案文件已上传，正在重新汇总')
      qc.invalidateQueries({ queryKey: ['paper', paperId] })
      qc.invalidateQueries({ queryKey: ['papers'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '上传失败', 'error'),
  })

  const reprocess = useMutation({
    mutationFn: () => api.reprocessPaper(paperId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paper', paperId] }),
    onError: (e) => toast(e instanceof ApiError ? e.message : '操作失败', 'error'),
  })

  const rename = useMutation({
    mutationFn: (title: string) => api.renamePaper(paperId!, title),
    onSuccess: () => {
      setEditingTitle(null)
      qc.invalidateQueries({ queryKey: ['paper', paperId] })
      qc.invalidateQueries({ queryKey: ['papers'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '改名失败', 'error'),
  })

  const delQuestion = useMutation({
    mutationFn: (qid: string) => api.deletePaperQuestion(paperId!, qid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paper', paperId] }),
    onError: (e) => toast(e instanceof ApiError ? e.message : '删除失败', 'error'),
  })

  if (paperQ.isPending)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    )
  if (paperQ.isError)
    return (
      <div className="py-20 text-center text-dim">
        <p>试卷不存在或已被删除</p>
        <Link to="/papers" className="mt-2 inline-block text-primary-600 dark:text-primary-400">
          返回试卷库
        </Link>
      </div>
    )

  const paper = paperQ.data
  const questions = paper.questions ?? []
  const missing = questions.filter((q) => !q.correct_answer).length

  if (paper.status === 'processing') {
    return (
      <div className="py-16 text-center">
        <Spinner className="mx-auto h-8 w-8" />
        <p className="mt-4 font-medium">{paper.progress?.label || '正在识别试卷…'}</p>
        <p className="mt-2 text-xs text-dim">识别完成后请核对标准答案，再开始批改</p>
      </div>
    )
  }

  if (paper.status === 'error') {
    return (
      <div className="py-20 text-center">
        <Icon name="alert" size={40} className="mx-auto text-rose-400" />
        <p className="mt-3 font-medium">识别失败</p>
        <p className="mt-1 text-sm text-dim">{paper.error}</p>
        <button onClick={() => reprocess.mutate()} className="btn-primary mt-4 px-4 py-2 text-sm">
          重新识别
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {editingTitle !== null ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (editingTitle.trim()) rename.mutate(editingTitle.trim())
              }}
            >
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                autoFocus
                maxLength={80}
                className="input w-full max-w-sm px-2 py-1 text-base font-bold"
              />
              <button type="submit" disabled={rename.isPending} className="shrink-0 text-sm text-primary-600 dark:text-primary-400">
                保存
              </button>
              <button type="button" onClick={() => setEditingTitle(null)} className="shrink-0 text-sm text-dim">
                取消
              </button>
            </form>
          ) : (
            <h2 className="flex items-center gap-1.5 font-serif text-xl font-bold">
              <span className="truncate">{paper.title || '试卷'}</span>
              <button
                onClick={() => setEditingTitle(paper.title || '')}
                title="修改试卷名称"
                className="icon-btn shrink-0 p-1"
              >
                <Icon name="edit" size={15} />
              </button>
            </h2>
          )}
          <p className="mt-0.5 text-xs text-dim">
            {paper.page_count ? `${paper.page_count} 页 · ` : ''}{questions.length} 题
            {paper.submission_count > 0 && ` · 已批改 ${paper.submission_count} 次`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!!paper.page_count && (
            <button onClick={() => setShowPages(true)} className="btn-outline px-3 py-1.5">
              <Icon name="book-open" size={15} /> 查看原卷
            </button>
          )}
          <button
            onClick={() => answersRef.current?.click()}
            disabled={addAnswers.isPending || picking}
            className="btn-outline px-3 py-1.5"
          >
            {addAnswers.isPending
              ? uploadPct != null && uploadPct < 100
                ? `上传 ${uploadPct}%`
                : '上传中…'
              : picking
                ? '正在处理照片…'
                : '补传答案文件'}
          </button>
          <button
            onClick={() => navigate(`/?paper=${paper.id}`)}
            className="btn-primary px-3 py-1.5"
          >
            <Icon name="pen" size={15} /> 去批改
          </button>
        </div>
      </div>

      <input
        ref={answersRef}
        type="file"
        multiple
        accept=".pdf,application/pdf,image/*"
        className="hidden"
        onChange={async (e) => {
          setPicking(true)
          try {
            const { files: fs, dropped } = await compressPicked(e.target.files, 30)
            e.target.value = ''
            if (dropped > 0) toast(`一次最多上传 30 个文件，已忽略 ${dropped} 个`, 'error')
            if (fs.length) addAnswers.mutate(fs)
          } finally {
            setPicking(false)
          }
        }}
      />

      {missing > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <p>
            有 <b>{missing}</b> 题缺少标准答案：可「补传答案文件」（参考答案在另一份 PDF/照片里），或在下表中手动填写。缺答案的题批改时会标为"待确认"。
          </p>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-dim">
              <th className="px-3 py-2.5 font-medium">题号</th>
              <th className="px-3 py-2.5 font-medium">题型</th>
              <th className="hidden px-3 py-2.5 font-medium sm:table-cell">题干</th>
              <th className="w-32 px-3 py-2.5 font-medium">标准答案</th>
              <th className="w-8 px-1 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {questions.map((q) => (
              <tr key={q.id} className="transition-colors hover:bg-surface-2/50">
                <td className="px-3 py-2 font-serif font-semibold whitespace-nowrap">{q.number}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-dim">
                  {q.type || q.section || '—'}
                </td>
                <td className="hidden max-w-md truncate px-3 py-2 text-ink2" title={q.stem ?? undefined}>
                  {q.stem}
                  {q.options && (
                    <span className="text-dim">
                      {' '}
                      {Object.entries(q.options).map(([k, v]) => `${k}.${v}`).join(' ')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <AnswerCell paper={paper} q={q} />
                </td>
                <td className="px-1 py-1.5">
                  <button
                    onClick={() => {
                      if (confirm(`确定删除第 ${q.number} 题吗？`)) delQuestion.mutate(q.id)
                    }}
                    title="删除此题"
                    className="rounded p-1 text-dim/60 transition-colors hover:text-rose-500"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {questions.length === 0 && (
          <p className="py-8 text-center text-sm text-dim">
            {paper.files && paper.files.length > 0 ? (
              <>
                没有识别到题目，请检查上传的文件或
                <button onClick={() => reprocess.mutate()} className="mx-1 text-primary-600 dark:text-primary-400">
                  重新识别
                </button>
                ，也可以在下方手动录入
              </>
            ) : (
              '手动录入题号和标准答案（适合只有答案没有卷子的情况）'
            )}
          </p>
        )}
        <AddQuestionRow paperId={paper.id} />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-dim">
        <Icon name="lightbulb" size={13} />
        修改标准答案会自动重判这份试卷下所有已批改的作答。
      </p>

      {showPages && !!paper.page_count && (
        <PaperViewer
          urlFor={(n) => paperPageImageUrl(paper.id, n)}
          pageCount={paper.page_count}
          onClose={() => setShowPages(false)}
        />
      )}
    </div>
  )
}
