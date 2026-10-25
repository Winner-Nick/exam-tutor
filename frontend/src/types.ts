export type QuestionStatus = 'correct' | 'wrong' | 'unknown' | 'subjective'
export type ExplainState = 'none' | 'queued' | 'generating' | 'done' | 'failed'
export type ResourceStatus = 'processing' | 'done' | 'ready' | 'error' | 'partial'

export interface User {
  id: number
  username: string
  role: 'admin' | 'user' | 'student'
}

export interface RegistrationOptions {
  bootstrap: boolean
  allow_open_register: boolean
}

export interface AdminUser {
  id: number
  username: string
  role: User['role']
  created_at?: number | null
  student_name?: string | null
}

export interface Explanation {
  knowledge_point?: string
  answer_analysis?: string
  why_wrong?: string
  tips?: string
  examples?: string
}

export interface ReviewAttempt {
  id?: number
  action?: 'attempt' | 'mastered' | 'reopen' | string
  answer?: string | null
  result: 'correct' | 'wrong' | 'mastered' | 'reopened' | string
  created_at: number
}

export interface ReviewState {
  mastered: boolean
  review_count: number
  streak: number
  last_reviewed_at: number | null
  next_review_at: number | null
  attempts?: ReviewAttempt[]
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
  revision: number
  explanation_revision?: number | null
  review?: ReviewState | null
  review_attempts?: ReviewAttempt[]
}

export interface MistakeQuestion extends Question {
  job_id: string
  job_title: string
  paper_id?: string | null
  student_id?: number | null
  student_name: string | null
  created_at?: number
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

export interface ResourceFile {
  id: string
  kind?: 'mixed' | 'questions' | 'answers' | 'submission'
  filename: string | null
  page_start: number | null
  page_count: number | null
  status?: 'ready' | 'processing' | 'error'
  error?: string | null
}

export interface Job {
  id: string
  filename: string | null
  kind: 'legacy' | 'submission'
  paper_id: string | null
  student_id: number | null
  student_name: string | null
  paper_title: string | null
  status: 'processing' | 'done' | 'error' | 'partial' | 'deleting'
  stage: string | null
  progress: Progress
  error: string | null
  page_count: number | null
  created_at: number
  meta: { title?: string; subject?: string; grade?: string; total_questions?: number }
  stats: Partial<JobStats>
  questions?: Question[]
  files?: ResourceFile[]
  failed_pages?: number[]
  accepted_partial?: boolean
  sync_pending?: boolean
}

export interface Student {
  id: number
  name: string
  is_self: 0 | 1
  created_at: number
  submission_count: number
  wrong_total: number | null
  account_username?: string | null
  grade?: string | null
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
  revision?: number
}

export type PaperFile = ResourceFile

export interface Paper {
  id: string
  title: string | null
  subject?: string | null
  grade?: string | null
  status: 'processing' | 'ready' | 'error' | 'partial' | 'deleting'
  stage: string | null
  progress: Progress
  error: string | null
  page_count: number | null
  created_at: number
  meta: { title?: string; subject?: string; grade?: string; total_questions?: number }
  question_count: number
  answered_count: number
  submission_count: number
  questions?: PaperQuestion[]
  files?: PaperFile[]
  failed_pages?: number[]
  accepted_partial?: boolean
}

export interface ChatMessage {
  id?: number | string
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

export interface Feedback {
  id: number
  username: string | null
  message: string | null
  page: string | null
  created_at: number
  diag: Record<string, unknown> & { errors?: { at: string; msg: string }[] }
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

export interface PageResult<T> {
  total: number
  items: T[]
}

export interface OverviewJob {
  id: string
  title: string
  student_id?: number | null
  student_name: string | null
  created_at: number
  stats: Partial<JobStats>
}

export interface OverviewSummary {
  total_jobs: number
  correct: number
  wrong: number
  unknown: number
  subjective: number
  no_objective_jobs?: number
}

export interface KnowledgeCoverage {
  covered: number
  total: number
  percent?: number
}

export interface StudentSummary {
  student_id: number
  student_name: string
  total_jobs: number
  correct: number
  wrong: number
  unknown: number
  subjective: number
}

export interface OverviewTrendPoint {
  id: string
  label: string
  pct: number
  created_at?: number
  date?: string
  correct?: number
  wrong?: number
}

export interface Overview {
  jobs: OverviewJob[]
  job_total: number
  job_limit: number
  job_offset: number
  trend: OverviewTrendPoint[]
  knowledge_points: { knowledge_point: string; wrong: number; total: number }[]
  summary: OverviewSummary
  knowledge_coverage: KnowledgeCoverage | number
  student_summaries: StudentSummary[]
}
