import type { Question } from '../types'

export function choiceLabels(value: string | null) {
  const text = (value ?? '').normalize('NFKC').toUpperCase().trim()
    .replace(/^[([\[（【]+|[)\]）】]+$/g, '')
  const compact = text.replace(/[\s,，、;；/\\|.．]+/g, '')
  if (!compact || !/^[\x00-\x7F]+$/.test(compact) || !/^[A-Z0-9]+$/.test(compact)) return new Set<string>()
  return new Set([...compact])
}

export function isMultipleChoice(question: Pick<Question, 'type' | 'section' | 'correct_answer'>) {
  const hint = `${question.type ?? ''} ${question.section ?? ''}`.toLowerCase()
  if (hint.includes('单选') || hint.includes('single')) return false
  return hint.includes('多选') || hint.includes('multi') || choiceLabels(question.correct_answer).size > 1
}

export function sameChoiceLabels(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}
