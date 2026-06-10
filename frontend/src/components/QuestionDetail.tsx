import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './Toast'
import { ExplanationCard } from './ExplanationCard'
import { StatusBadge } from './StatusBadge'
import type { Job, Question } from '../types'

export function QuestionDetail({ job, question }: { job: Job; question: Question }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [showPassage, setShowPassage] = useState(false)

  const patchQuestion = (updated: Question, stats: Job['stats']) => {
    qc.setQueryData<Job>(['job', job.id], (old) =>
      old
        ? {
            ...old,
            stats,
            questions: old.questions?.map((x) => (x.id === updated.id ? updated : x)),
          }
        : old,
    )
  }

  const override = useMutation({
    mutationFn: (body: { student_answer?: string | null; status?: string }) =>
      api.override(job.id, question.id, body),
    onSuccess: ({ question: updated, stats }) => {
      patchQuestion(updated, stats)
      toast('已更新')
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '更新失败', 'error'),
  })

  const explain = useMutation({
    mutationFn: () => api.requestExplain(job.id, question.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job', job.id] }),
  })

  const opts = question.options ? Object.entries(question.options) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">第 {question.number} 题</h3>
        <StatusBadge status={question.status} />
        {question.section && (
          <span className="text-xs text-slate-400">
            {question.section}
            {question.type && question.type !== question.section ? ` · ${question.type}` : ''}
          </span>
        )}
        {question.knowledge_point && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {question.knowledge_point}
          </span>
        )}
      </div>

      {question.passage && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <button
            onClick={() => setShowPassage((v) => !v)}
            className="text-xs font-medium text-primary-600 dark:text-primary-400"
          >
            {showPassage ? '收起原文 ▲' : '展开原文 ▼'}
          </button>
          {showPassage && (
            <p className="mt-2 leading-relaxed whitespace-pre-wrap text-slate-600 dark:text-slate-300">
              {question.passage}
            </p>
          )}
        </div>
      )}

      {question.stem && <p className="leading-relaxed whitespace-pre-wrap">{question.stem}</p>}

      {opts.length > 0 && (
        <div className="space-y-1.5">
          {opts.map(([k, v]) => {
            const isStudent = question.student_answer === k
            const isCorrect = question.correct_answer === k
            return (
              <button
                key={k}
                disabled={override.isPending}
                onClick={() => override.mutate({ student_answer: k })}
                title="点击把它设为学生的作答"
                className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                  isCorrect
                    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                    : isStudent
                      ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20'
                      : 'border-slate-200 bg-white hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isCorrect
                      ? 'bg-emerald-500 text-white'
                      : isStudent
                        ? 'bg-rose-500 text-white'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {k}
                </span>
                <span className="flex-1">{v}</span>
                <span className="shrink-0 space-x-1 text-xs">
                  {isStudent && <span className="text-rose-500">学生选</span>}
                  {isCorrect && <span className="text-emerald-600">✓ 正确</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">人工核对：</span>
        {(['correct', 'wrong', 'unknown'] as const).map((st) => (
          <button
            key={st}
            disabled={override.isPending || question.status === st}
            onClick={() => override.mutate({ status: st })}
            className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-500 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400"
          >
            标为{st === 'correct' ? '答对' : st === 'wrong' ? '答错' : '待确认'}
          </button>
        ))}
      </div>

      {(question.status === 'wrong' || question.status === 'unknown' || question.explanation) && (
        <ExplanationCard question={question} onRequestExplain={() => explain.mutate()} />
      )}
    </div>
  )
}
