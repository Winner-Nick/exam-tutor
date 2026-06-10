import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Markdown } from '../components/Markdown'
import { Spinner } from '../components/Spinner'
import { StudentFilter } from '../components/StudentFilter'

export function MistakesPage() {
  const [studentId, setStudentId] = useState<number | null>(null)
  const q = useQuery({
    queryKey: ['mistakes', studentId],
    queryFn: () => api.mistakes(studentId),
  })
  const [open, setOpen] = useState<string | null>(null)

  const groups = q.data?.groups ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          按知识点汇总所有试卷的错题，温故知新。
        </p>
        <StudentFilter value={studentId} onChange={setStudentId} />
      </div>
      {q.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      ) : q.isError ? (
        <p className="py-16 text-center text-slate-400">加载失败，请刷新重试</p>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <p className="text-3xl">🎉</p>
          <p className="mt-2">错题本是空的，太棒了！</p>
        </div>
      ) : null}
      {groups.map((g) => (
        <div
          key={g.knowledge_point}
          className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <button
            onClick={() => setOpen(open === g.knowledge_point ? null : g.knowledge_point)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <span className="font-semibold">
              {g.knowledge_point}
              <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                {g.questions.length} 题
              </span>
            </span>
            <span className="text-slate-400">{open === g.knowledge_point ? '▲' : '▼'}</span>
          </button>
          {open === g.knowledge_point && (
            <div className="space-y-3 border-t border-slate-100 p-4 dark:border-slate-800">
              {g.questions.map((mq) => (
                <div
                  key={`${mq.job_id}-${mq.id}`}
                  className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <Link to={`/jobs/${mq.job_id}`} className="text-primary-600 hover:underline dark:text-primary-400">
                      {mq.job_title}
                    </Link>
                    {mq.student_name && <span>👤 {mq.student_name}</span>}
                    <span>第 {mq.number} 题</span>
                    {mq.student_answer && mq.correct_answer && (
                      <span>
                        学生选 <b className="text-rose-500">{mq.student_answer}</b>，正确{' '}
                        <b className="text-emerald-600">{mq.correct_answer}</b>
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{mq.stem}</p>
                  {mq.explanation?.tips && (
                    <div className="mt-2 rounded-lg bg-primary-50/60 p-2 dark:bg-primary-900/20">
                      <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">✨ 技巧：</span>
                      <Markdown text={String(mq.explanation.tips)} className="inline" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
