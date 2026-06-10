export type QuestionStatus = 'correct' | 'wrong' | 'unknown' | 'subjective'
export type ExplainState = 'none' | 'queued' | 'generating' | 'done' | 'failed'

export interface User {
  id: number
  username: string
  role: 'admin' | 'user'
}

export interface Explanation {
  knowledge_point?: string
  answer_analysis?: string
  why_wrong?: string
  tips?: string
  examples?: string
}

export interface Question {
  id: string
  number: string
  section: string | null
  type: string | null
  stem: string | null
  options: Record<string, string> | null
  passage: string | null
  student_answer: string | null
  correct_answer: string | null
  status: QuestionStatus
  knowledge_point: string | null
  explanation: Explanation | null
  explain_state: ExplainState
}

export interface JobStats {
  total: number
  correct: number
  wrong: number
  unknown: number
  subjective: number
}

export interface Progress {
  done: number
  total: number
  label: string | null
}

export interface Job {
  id: string
  filename: string | null
  status: 'processing' | 'done' | 'error'
  stage: string | null
  progress: Progress
  error: string | null
  page_count: number | null
  created_at: number
  meta: { title?: string; subject?: string; grade?: string; total_questions?: number }
  stats: Partial<JobStats>
  questions?: Question[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
