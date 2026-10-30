import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useSerialTasks } from '../hooks/useSerialTasks'
import type { Job, Question } from '../types'
import { choiceLabels, isMultipleChoice, sameChoiceLabels } from '../utils/choiceAnswers'
import { invalidateLearningData } from '../utils/query'
import { ExplanationCard } from './ExplanationCard'
import { Icon } from './Icon'
import { StatusBadge } from './StatusBadge'
import { useToast } from './Toast'

export function QuestionDetail({
  job,
  question,
  canEdit = true,
  onAsk,
}: {
  job: Job
  question: Question
  canEdit?: boolean
  onAsk?: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { busy, enqueue } = useSerialTasks()
  const [showPassage, setShowPassage] = useState(false)
  const [answerDraft, setAnswerDraft] = useState(question.student_answer ?? '')
  const multiple = isMultipleChoice(question)
  const [choiceDraft, setChoiceDraft] = useState<Set<string>>(() => choiceLabels(question.student_answer))

  useEffect(() => {
    setAnswerDraft(question.student_answer ?? '')
    setChoiceDraft(choiceLabels(question.student_answer))
    setShowPassage(false)
  }, [question.id, question.revision, question.student_answer])

  const patchQuestion = (updated: Question, stats: Job['stats']) => {
    qc.setQueryData<Job>(['job', job.id], (old) => old ? {
      ...old,
      stats,
      questions: old.questions?.map((item) => item.id === updated.id ? updated : item),
    } : old)
  }

  const updateOverride = async (body: { student_answer?: string | null; status?: string }) => {
    try {
      await enqueue(async () => {
        const { question: updated, stats } = await api.override(job.id, question.id, body)
        patchQuestion(updated, stats)
        await invalidateLearningData(qc)
      })
      toast('作答与判分已更新')
    } catch (error) {
      toast(error instanceof ApiError ? error.message : '更新失败，请重试', 'error')
    }
  }

  const requestExplanation = async () => {
    try {
      await enqueue(async () => {
        await api.requestExplain(job.id, question.id)
        await qc.invalidateQueries({ queryKey: ['job', job.id] })
      })
      toast('讲解已加入生成队列')
    } catch (error) {
      toast(error instanceof ApiError ? error.message : '无法生成讲解，请重试', 'error')
    }
  }

  const opts = question.options ? Object.entries(question.options) : []
  const correctLabels = choiceLabels(question.correct_answer)
  const studentLabels = choiceLabels(question.student_answer)
  const answerDirty = multiple
    ? !sameChoiceLabels(choiceDraft, studentLabels)
    : answerDraft !== (question.student_answer ?? '')

  function saveChoices() {
    const answer = opts.map(([key]) => key).filter((key) => choiceDraft.has(key)).join('') || null
    void updateOverride({ student_answer: answer })
  }

  return (
    <div className="space-y-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-lg font-bold">第 {question.number} 题</h2>
        <StatusBadge status={question.status} />
        {question.section && <span className="text-xs text-dim">{question.section}{question.type && question.type !== question.section ? ` · ${question.type}` : ''}</span>}
        {question.knowledge_point && <span className="badge bg-surface-2 text-ink2">{question.knowledge_point}</span>}
        {onAsk && (
          <button onClick={onAsk} className="btn-outline ml-auto px-3 text-xs">
            <Icon name="chat" size={14} /> 问这道题
          </button>
        )}
      </div>

      {question.passage && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <button onClick={() => setShowPassage((value) => !value)} aria-expanded={showPassage} className="min-h-11 text-xs font-medium text-primary-700 dark:text-primary-300">
            {showPassage ? '收起原文 ▲' : '展开原文 ▼'}
          </button>
          {showPassage && <p className="mt-2 leading-relaxed whitespace-pre-wrap text-ink2">{question.passage}</p>}
        </div>
      )}

      {question.stem ? <p className="leading-relaxed whitespace-pre-wrap">{question.stem}</p> : <p className="text-sm text-dim">未识别到题干，可在试卷库中补全。</p>}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className={`rounded-2xl border p-3.5 ${question.status === 'wrong' ? 'border-rose-200 bg-rose-50/65 dark:border-rose-900/50 dark:bg-rose-950/25' : 'border-line bg-surface-2/55'}`}>
          <dt className="flex items-center gap-1.5 text-xs font-medium text-dim"><Icon name="user" size={13} />学生答案</dt>
          <dd className="mt-2 text-[15px] leading-6 whitespace-pre-wrap text-ink">{question.student_answer?.trim() || '未作答 / 未识别'}</dd>
        </div>
        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200"><Icon name="check-circle" size={13} />标准答案</dt>
          <dd className="mt-2 text-[15px] leading-6 whitespace-pre-wrap text-emerald-950 dark:text-emerald-50">{question.correct_answer?.trim() || '未提供，需人工确认'}</dd>
        </div>
      </dl>

      {opts.length > 0 && (
        <div className="space-y-1.5">
          {opts.map(([key, value]) => {
            const isStudent = multiple ? choiceDraft.has(key) : studentLabels.has(key)
            const isCorrect = correctLabels.has(key)
            const className = `flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-sm ${
              isCorrect
                ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                : isStudent
                  ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20'
                  : 'border-line bg-surface'
            } ${canEdit ? 'min-h-11 hover:border-primary-300 dark:hover:border-primary-700' : ''}`
            const content = (
              <>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isCorrect ? 'bg-emerald-600 text-white' : isStudent ? 'bg-rose-600 text-white' : 'bg-surface-2 text-ink2'}`}>{key}</span>
                <span className="flex-1">{value}</span>
                <span className="shrink-0 space-x-1 text-xs">
                  {isStudent && <span className="text-rose-700 dark:text-rose-300">学生选</span>}
                  {isCorrect && <span className="text-emerald-700 dark:text-emerald-300">✓ 正确</span>}
                </span>
              </>
            )
            if (canEdit && multiple) {
              return (
                <label key={key} className={className}>
                  <input
                    type="checkbox"
                    checked={choiceDraft.has(key)}
                    disabled={busy}
                    onChange={() => setChoiceDraft((old) => {
                      const next = new Set(old)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary-600"
                  />
                  {content}
                </label>
              )
            }
            return canEdit ? (
              <button key={key} type="button" disabled={busy} onClick={() => void updateOverride({ student_answer: key })} className={className}>{content}</button>
            ) : (
              <div key={key} className={className}>{content}</div>
            )
          })}
          {canEdit && multiple && <button disabled={!answerDirty || busy} onClick={saveChoices} className="btn-primary mt-2 px-4">保存作答</button>}
        </div>
      )}

      {canEdit && opts.length === 0 && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <label htmlFor={`student-answer-${question.id}`} className="text-sm font-medium text-ink2">修正文本作答</label>
          <textarea
            id={`student-answer-${question.id}`}
            value={answerDraft}
            onChange={(event) => setAnswerDraft(event.target.value)}
            rows={3}
            className="input"
            placeholder="输入学生实际作答；留空表示未作答"
          />
          <button
            disabled={!answerDirty || busy}
            onClick={() => void updateOverride({ student_answer: answerDraft.trim() || null })}
            className="btn-primary px-4"
          >
            保存作答
          </button>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink2">人工核对：</span>
          {(['correct', 'wrong', 'unknown'] as const).map((status) => (
            <button key={status} disabled={busy || question.status === status} onClick={() => void updateOverride({ status })} className="btn-outline px-3 text-xs">
              标为{status === 'correct' ? '答对' : status === 'wrong' ? '答错' : '待确认'}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="text-xs text-ink2" role="status">正在按顺序保存，请稍候…</p>}
      {(question.status === 'wrong' || question.status === 'unknown' || question.explanation) && (
        <ExplanationCard question={question} pending={busy} onRequestExplain={() => void requestExplanation()} />
      )}
    </div>
  )
}
