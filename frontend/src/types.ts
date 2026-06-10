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
  kind: 'legacy' | 'submission'
  paper_id: string | null
  student_id: number | null
  student_name: string | null
  paper_title: string | null
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

export interface Student {
  id: number
  name: string
  is_self: 0 | 1
  created_at: number
  submission_count: number
  wrong_total: number | null
}

export interface PaperQuestion {
  id: string
  number: string
  section: string | null
  type: string | null
  stem: string | null
  options: Record<string, string> | null
  passage: string | null
  correct_answer: string | null
  knowledge_point: string | null
}

export interface PaperFile {
  id: string
  kind: 'mixed' | 'questions' | 'answers'
  filename: string | null
  page_start: number | null
  page_count: number | null
}

export interface Paper {
  id: string
  title: string | null
  status: 'processing' | 'ready' | 'error'
  stage: string | null
  progress: Progress
  error: string | null
  page_count: number | null
  created_at: number
  meta: { title?: string; total_questions?: number }
  question_count: number
  answered_count: number
  submission_count: number
  questions?: PaperQuestion[]
  files?: PaperFile[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Release {
  tag: string
  name: string
  body: string
  published_at: string | null
  prerelease: boolean
  apk_size: number | null
}

export interface Invite {
  code: string
  created_by_name: string | null
  max_uses: number
  used_count: number
  expires_at: number | null
  created_at: number | null
  status: 'active' | 'used_up' | 'expired'
}
