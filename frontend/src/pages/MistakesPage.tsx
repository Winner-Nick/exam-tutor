import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
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
        <p className="text-sm text-ink2">按知识点汇总所有试卷的错题，温故知新。</p>
        <StudentFilter value={studentId} onChange={setStudentId} />
      </div>
      {q.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-14 rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="py-16 text-center text-dim">加载失败，请刷新重试</p>
      ) : groups.length === 0 ? (
        <div className="card py-16 text-center">
          <Icon name="party-popper" size={34} className="mx-auto text-emerald-500" />
          <p className="mt-3 font-medium">错题本是空的，太棒了！</p>
          <p className="mt-1 text-sm text-dim">批改产生错题后会按知识点自动归集到这里</p>
        </div>
      ) : null}
      {groups.map((g) => {
        const expanded = open === g.knowledge_point
        return (
          <div key={g.knowledge_point} className="card overflow-hidden">
            <button
              onClick={() => setOpen(expanded ? null : g.knowledge_point)}
              className="flex w-full items-center justify-between px-4 py-3.5 transition-colors hover:bg-surface-2/50"
            >
              <span className="font-semibold">
                {g.knowledge_point}
                <span className="badge ml-2 bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
                  {g.questions.length} 题
                </span>
              </span>
              <Icon
                name="chevron-down"
                size={17}
                className={`text-dim transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
            {expanded && (
              <div className="fade-up space-y-3 border-t border-line p-4">
                {g.questions.map((mq) => (
                  <div key={`${mq.job_id}-${mq.id}`} className="rounded-xl bg-surface-2 p-3.5 text-sm">
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-dim">
                      <Link to={`/jobs/${mq.job_id}`} className="text-primary-600 hover:underline dark:text-primary-400">
                        {mq.job_title}
                      </Link>
                      {mq.student_name && (
                        <span className="flex items-center gap-0.5">
                          <Icon name="user" size={11} /> {mq.student_name}
                        </span>
                      )}
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
                      <div className="mt-2 rounded-lg bg-primary-50/60 p-2.5 dark:bg-primary-900/20">
                        <span className="flex items-center gap-1 text-xs font-semibold text-primary-700 dark:text-primary-300">
                          <Icon name="sparkles" size={12} /> 技巧
                        </span>
                        <Markdown text={String(mq.explanation.tips)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
