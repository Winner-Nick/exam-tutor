import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { PaperQuestion } from '../types'
import { optionsText, parseOptions } from '../utils/paperOptions'
import { invalidateLearningData } from '../utils/query'
import { Dialog } from './Dialog'
import { useToast } from './Toast'

export function PaperQuestionDialog({ paperId, question, onClose }: { paperId: string; question: PaperQuestion; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const initialOptions = useRef({ text: optionsText(question.options), value: question.options })
  const [number, setNumber] = useState(question.number)
  const [type, setType] = useState(question.type ?? '')
  const [stem, setStem] = useState(question.stem ?? '')
  const [options, setOptions] = useState(initialOptions.current.text)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [passage, setPassage] = useState(question.passage ?? '')
  const [answer, setAnswer] = useState(question.correct_answer ?? '')
  const [knowledgePoint, setKnowledgePoint] = useState(question.knowledge_point ?? '')

  const save = useMutation({
    mutationFn: (nextOptions: Record<string, string> | null) => api.updatePaperQuestion(paperId, question.id, {
      number: number.trim(),
      type: type.trim() || null,
      stem: stem.trim() || null,
      options: nextOptions,
      passage: passage.trim() || null,
      correct_answer: answer.trim() || null,
      knowledge_point: knowledgePoint.trim() || null,
    }),
    onSuccess: async ({ regraded }) => {
      toast(regraded ? `题目已保存，并重判 ${regraded} 份作答` : '题目内容已保存')
      await invalidateLearningData(qc)
      onClose()
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '保存失败，请重试', 'error'),
  })

  function submit() {
    if (!number.trim()) return
    const parsed = options === initialOptions.current.text
      ? { options: initialOptions.current.value, error: null }
      : parseOptions(options)
    setOptionsError(parsed.error)
    if (!parsed.error) save.mutate(parsed.options)
  }

  return (
    <Dialog title={`编辑第 ${question.number} 题`} onClose={onClose} hideClose={save.isPending} preventClose={save.isPending} className="max-w-2xl">
      <form onSubmit={(event) => { event.preventDefault(); submit() }} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink2">题号<input value={number} onChange={(event) => setNumber(event.target.value)} required maxLength={20} autoFocus className="input mt-1" /></label>
          <label className="text-sm font-medium text-ink2">题型<input value={type} onChange={(event) => setType(event.target.value)} placeholder="如：单选、填空、解答" className="input mt-1" /></label>
        </div>
        <label className="block text-sm font-medium text-ink2">题干<textarea value={stem} onChange={(event) => setStem(event.target.value)} rows={4} className="input mt-1" /></label>
        <label className="block text-sm font-medium text-ink2">选项<span className="ml-1 text-xs font-normal text-dim">每行一个，如 A. 选项内容；续行请缩进，无选项题可留空</span><textarea value={options} onChange={(event) => { setOptions(event.target.value); setOptionsError(null) }} rows={4} aria-invalid={!!optionsError} aria-describedby={optionsError ? 'options-error' : undefined} className="input mt-1 font-mono" /></label>
        {optionsError && <p id="options-error" className="text-sm text-rose-700 dark:text-rose-300" role="alert">{optionsError}</p>}
        <label className="block text-sm font-medium text-ink2">阅读材料 / 共用原文<textarea value={passage} onChange={(event) => setPassage(event.target.value)} rows={3} className="input mt-1" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink2">标准答案<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={2} className="input mt-1" placeholder="主观题也可填写参考答案" /></label>
          <label className="text-sm font-medium text-ink2">知识点<textarea value={knowledgePoint} onChange={(event) => setKnowledgePoint(event.target.value)} rows={2} className="input mt-1" /></label>
        </div>
        <p className="text-xs leading-relaxed text-ink2">保存标准答案或题目内容后，关联作答会按后端结果重新判分，旧讲解将按题目版本失效。</p>
        {save.isError && <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">{save.error instanceof ApiError ? save.error.message : '保存失败，请重试'}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={save.isPending} onClick={onClose} className="btn-ghost px-4">取消</button><button disabled={!number.trim() || save.isPending} className="btn-primary px-5">{save.isPending ? '保存中…' : '保存题目'}</button></div>
      </form>
    </Dialog>
  )
}
