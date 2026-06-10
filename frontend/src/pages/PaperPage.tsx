import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, paperPageImageUrl } from '../api'
import { PaperViewer } from '../components/PaperViewer'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import type { Paper, PaperQuestion } from '../types'

function AnswerCell({ paper, q }: { paper: Paper; q: PaperQuestion }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [value, setValue] = useState(q.correct_answer ?? '')

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
      className={`w-full min-w-16 rounded-lg border px-2 py-1 text-sm ${
        q.correct_answer
          ? 'border-slate-200 dark:border-slate-700'
          : 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-900/20'
      } dark:bg-slate-800`}
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
      className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800"
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
        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
      />
      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="标准答案"
        maxLength={100}
        className="w-36 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
      />
      <button
        type="submit"
        disabled={!number.trim() || add.isPending}
        className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-medium hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800"
      >
        ＋ 添加题目
      </button>
      <span className="text-xs text-slate-400">识别漏了题，或只有答案没有卷子时手动录入</span>
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
  const [editingTitle, setEditingTitle] = useState<string | null>(null)

  const paperQ = useQuery({
    queryKey: ['paper', paperId],
    queryFn: () => api.getPaper(paperId!),
    enabled: !!paperId,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 3000 : false),
  })

  const addAnswers = useMutation({
    mutationFn: (files: File[]) => api.addPaperFiles(paperId!, files, 'answers'),
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
      <div className="py-20 text-center text-slate-400">
        <p>试卷不存在或已被删除</p>
        <Link to="/papers" className="mt-2 inline-block text-primary-600">
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
        <p className="mt-2 text-xs text-slate-400">识别完成后请核对标准答案，再开始批改</p>
      </div>
    )
  }

  if (paper.status === 'error') {
    return (
      <div className="py-20 text-center">
        <p className="text-3xl">😵</p>
        <p className="mt-3 font-medium">识别失败</p>
        <p className="mt-1 text-sm text-slate-400">{paper.error}</p>
        <button
          onClick={() => reprocess.mutate()}
          className="mt-4 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white"
        >
          重新识别
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
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
                className="w-full max-w-sm rounded-lg border border-slate-300 px-2 py-1 text-base font-bold dark:border-slate-700 dark:bg-slate-800"
              />
              <button type="submit" disabled={rename.isPending} className="shrink-0 text-sm text-primary-600">
                保存
              </button>
              <button type="button" onClick={() => setEditingTitle(null)} className="shrink-0 text-sm text-slate-400">
                取消
              </button>
            </form>
          ) : (
            <h2 className="flex items-center gap-1.5 text-lg font-bold">
              <span className="truncate">{paper.title || '试卷'}</span>
              <button
                onClick={() => setEditingTitle(paper.title || '')}
                title="修改试卷名称"
                className="shrink-0 rounded p-0.5 text-sm text-slate-300 hover:text-slate-500"
              >
                ✏️
              </button>
            </h2>
          )}
          <p className="text-xs text-slate-400">
            {paper.page_count ? `${paper.page_count} 页 · ` : ''}{questions.length} 题
            {paper.submission_count > 0 && ` · 已批改 ${paper.submission_count} 次`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!!paper.page_count && (
            <button
              onClick={() => setShowPages(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900"
            >
              📖 查看原卷
            </button>
          )}
          <button
            onClick={() => answersRef.current?.click()}
            disabled={addAnswers.isPending}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-primary-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
          >
            {addAnswers.isPending ? '上传中…' : '📎 补传答案文件'}
          </button>
          <button
            onClick={() => navigate(`/?paper=${paper.id}`)}
            className="rounded-xl bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            ✏️ 去批改
          </button>
        </div>
      </div>

      <input
        ref={answersRef}
        type="file"
        multiple
        accept=".pdf,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? [])
          if (fs.length) addAnswers.mutate(fs.slice(0, 5))
          e.target.value = ''
        }}
      />

      {missing > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          ⚠️ 有 <b>{missing}</b> 题缺少标准答案：可「补传答案文件」（参考答案在另一份 PDF/照片里），或在下表中手动填写。缺答案的题批改时会标为"待确认"。
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
              <th className="px-3 py-2 font-medium">题号</th>
              <th className="px-3 py-2 font-medium">题型</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">题干</th>
              <th className="w-32 px-3 py-2 font-medium">标准答案</th>
              <th className="w-8 px-1 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {questions.map((q) => (
              <tr key={q.id}>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{q.number}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-slate-400">
                  {q.type || q.section || '—'}
                </td>
                <td className="hidden max-w-md truncate px-3 py-2 text-slate-500 sm:table-cell dark:text-slate-400" title={q.stem ?? undefined}>
                  {q.stem}
                  {q.options && (
                    <span className="text-slate-400">
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
                    className="rounded p-1 text-slate-200 hover:text-rose-500 dark:text-slate-700 dark:hover:text-rose-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {questions.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            {paper.files && paper.files.length > 0 ? (
              <>
                没有识别到题目，请检查上传的文件或
                <button onClick={() => reprocess.mutate()} className="mx-1 text-primary-600">
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

      <p className="text-xs text-slate-400">
        💡 修改标准答案会自动重判这份试卷下所有已批改的作答。
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
