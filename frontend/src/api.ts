import type {
  AdminUser,
  ChatMessage,
  Feedback,
  Invite,
  Job,
  JobStats,
  MistakeQuestion,
  Overview,
  Paper,
  PaperQuestion,
  Question,
  RegistrationOptions,
  Release,
  Student,
  User,
} from './types'

export type ApiErrorCode = 'http' | 'network' | 'timeout' | 'abort'

export class ApiError extends Error {
  status: number
  code: ApiErrorCode

  constructor(status: number, detail: string, code: ApiErrorCode = 'http') {
    super(detail)
    this.status = status
    this.code = code
  }
}

export const UNAUTHORIZED_EVENT = 'exam-tutor:unauthorized'

function notifyUnauthorized(path: string) {
  if (path === '/api/auth/login' || path === '/api/auth/register') return
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { path } }))
}

function errorDetail(status: number, value: unknown) {
  if (value && typeof value === 'object' && 'detail' in value) {
    const detail = value.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map((item) => item?.msg ?? '输入无效').join('；')
  }
  return `请求失败 (${status})`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, '请求已取消', 'abort')
    }
    throw new ApiError(0, '网络连接失败，请检查网络后重试', 'network')
  }
  let text: string
  try {
    text = await res.text()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, '请求已取消', 'abort')
    }
    throw new ApiError(0, '网络连接中断，请检查网络后重试', 'network')
  }
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (res.ok) throw new ApiError(res.status, '服务器响应格式错误')
    }
  }
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized(path)
    throw new ApiError(res.status, errorDetail(res.status, data))
  }
  return data as T
}

export interface UploadOptions {
  onProgress?: (pct: number) => void
  signal?: AbortSignal
  timeoutMs?: number
}

function upload<T>(path: string, fd: FormData, options: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    xhr.open('POST', path)
    xhr.timeout = options.timeoutMs ?? 180_000
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort)
      let data: unknown = null
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        reject(new ApiError(xhr.status, '服务器响应格式错误'))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T)
      } else {
        if (xhr.status === 401) notifyUnauthorized(path)
        reject(new ApiError(xhr.status, errorDetail(xhr.status, data)))
      }
    }
    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new ApiError(0, '网络连接中断，请检查网络后重试', 'network'))
    }
    xhr.ontimeout = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new ApiError(0, '上传超时，已保留所选文件，请重试', 'timeout'))
    }
    xhr.onabort = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new ApiError(0, '上传已取消，所选文件仍保留', 'abort'))
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) xhr.abort()
    else xhr.send(fd)
  })
}

export interface ListParams {
  q?: string
  limit?: number
  offset?: number
}

export interface JobListParams extends ListParams {
  studentId?: number | null
  paperId?: string | null
}

export interface MistakeFilters {
  studentId?: number | null
  paperId?: string | null
  review?: 'all' | 'pending' | 'mastered' | 'due'
  q?: string
  days?: number
}

export type PaperQuestionInput = Partial<
  Pick<PaperQuestion, 'number' | 'type' | 'stem' | 'options' | 'passage' | 'correct_answer' | 'knowledge_point'>
>

function listQuery(params: ListParams) {
  const search = new URLSearchParams()
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.limit != null) search.set('limit', String(params.limit))
  if (params.offset != null) search.set('offset', String(params.offset))
  return search
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  registrationOptions: () => request<RegistrationOptions>('/api/auth/registration-options'),
  login: (username: string, password: string) =>
    request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string, invite_code: string | null) =>
    request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, invite_code }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (old_password: string, new_password: string) =>
    request<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ old_password, new_password }),
    }),
  createInvite: (max_uses: number, ttl_days: number | null) =>
    request<{ code: string }>('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ max_uses, ttl_days }),
    }),
  listInvites: () => request<{ invites: Invite[] }>('/api/admin/invites'),
  revokeInvite: (code: string) =>
    request<{ ok: boolean }>(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  listAdminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  resetAdminUserPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  listStudents: () => request<{ students: Student[] }>('/api/students'),
  createStudent: (name: string) =>
    request<Student>('/api/students', { method: 'POST', body: JSON.stringify({ name }) }),
  renameStudent: (id: number, name: string) =>
    request<Student>(`/api/students/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteStudent: (id: number) =>
    request<{ ok: boolean }>(`/api/students/${id}`, { method: 'DELETE' }),
  createStudentAccount: (id: number, username: string, password: string) =>
    request<{ id: number; username: string }>(`/api/students/${id}/account`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  resetStudentAccountPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/api/students/${id}/account/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  deleteStudentAccount: (id: number) =>
    request<{ ok: boolean }>(`/api/students/${id}/account`, { method: 'DELETE' }),

  listPapers: (params: ListParams = {}) => {
    const search = listQuery(params)
    return request<{ papers: Paper[]; total: number }>(`/api/papers${search.size ? `?${search}` : ''}`)
  },
  getPaper: (id: string) => request<Paper>(`/api/papers/${id}`),
  createPaper: (
    files: File[], title: string | null, options?: UploadOptions,
    details: { subject?: string; grade?: string } = {},
  ) => {
    const fd = new FormData()
    files.forEach((file) => fd.append('files', file))
    if (title) fd.append('title', title)
    if (details.subject?.trim()) fd.append('subject', details.subject.trim())
    if (details.grade?.trim()) fd.append('grade', details.grade.trim())
    return upload<{ paper_id: string }>('/api/papers', fd, options)
  },
  addPaperFiles: (
    id: string,
    files: File[],
    kind: 'answers' | 'questions' | 'mixed',
    options?: UploadOptions,
  ) => {
    const fd = new FormData()
    files.forEach((file) => fd.append('files', file))
    fd.append('kind', kind)
    return upload<{ ok: boolean }>(`/api/papers/${id}/files`, fd, options)
  },
  deletePaperFile: (id: string, fileId: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }),
  retryPaper: (id: string) => request<{ ok: boolean }>(`/api/papers/${id}/retry`, { method: 'POST', body: '{}' }),
  acceptPaperPartial: (id: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/accept-partial`, { method: 'POST', body: '{}' }),
  renamePaper: (
    id: string,
    details: string | { title?: string; subject?: string | null; grade?: string | null },
  ) =>
    request<Paper>(`/api/papers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(typeof details === 'string' ? { title: details } : details),
    }),
  createManualPaper: (details: string | { title: string; subject?: string; grade?: string }) =>
    request<{ paper_id: string }>('/api/papers/manual', {
      method: 'POST',
      body: JSON.stringify(typeof details === 'string' ? { title: details } : details),
    }),
  addPaperQuestion: (id: string, body: PaperQuestionInput & { number: string }) =>
    request<PaperQuestion>(`/api/papers/${id}/questions`, { method: 'POST', body: JSON.stringify(body) }),
  updatePaperQuestion: (id: string, qid: string, body: PaperQuestionInput) =>
    request<{ question: PaperQuestion; regraded?: number }>(`/api/papers/${id}/questions/${qid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  setPaperAnswer: (id: string, qid: string, correct_answer: string | null) =>
    request<{ question: PaperQuestion; regraded: number }>(`/api/papers/${id}/questions/${qid}`, {
      method: 'PATCH',
      body: JSON.stringify({ correct_answer }),
    }),
  completePaperKnowledgePoints: (id: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/knowledge-points`, { method: 'POST', body: '{}' }),
  deletePaperQuestion: (id: string, qid: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/questions/${qid}`, { method: 'DELETE' }),
  deletePaper: (id: string) => request<{ ok: boolean }>(`/api/papers/${id}`, { method: 'DELETE' }),
  reprocessPaper: (id: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/reprocess`, { method: 'POST', body: '{}' }),

  listJobs: (params: JobListParams = {}) => {
    const search = listQuery(params)
    if (params.studentId != null) search.set('student_id', String(params.studentId))
    if (params.paperId) search.set('paper_id', params.paperId)
    return request<{ jobs: Job[]; total: number }>(`/api/jobs${search.size ? `?${search}` : ''}`)
  },
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  deleteJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  retryJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/retry`, { method: 'POST', body: '{}' }),
  acceptJobPartial: (id: string) =>
    request<{ ok: boolean }>(`/api/jobs/${id}/accept-partial`, { method: 'POST', body: '{}' }),
  deleteJobFile: (id: string, fileId: string) =>
    request<{ ok: boolean }>(`/api/jobs/${id}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }),
  createSubmission: (
    paperId: string,
    studentId: number,
    files: File[],
    usePaperFiles = false,
    options?: UploadOptions,
  ) => {
    const fd = new FormData()
    fd.append('paper_id', paperId)
    fd.append('student_id', String(studentId))
    files.forEach((file) => fd.append('files', file))
    if (usePaperFiles) fd.append('use_paper_files', 'true')
    return upload<{ job_id: string }>('/api/submissions', fd, options)
  },
  addSubmissionFiles: (jobId: string, files: File[], options?: UploadOptions) => {
    const fd = new FormData()
    files.forEach((file) => fd.append('files', file))
    return upload<{ ok: boolean }>(`/api/jobs/${jobId}/files`, fd, options)
  },

  override: (jobId: string, qid: string, body: { student_answer?: string | null; status?: string }) =>
    request<{ question: Question; stats: JobStats }>(`/api/jobs/${jobId}/questions/${qid}/override`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  requestExplain: (jobId: string, qid: string) =>
    request<{ explain_state: string }>(`/api/jobs/${jobId}/questions/${qid}/explain`, {
      method: 'POST',
      body: '{}',
    }),
  review: (
    jobId: string,
    qid: string,
    body: { action: 'attempt' | 'mastered' | 'reopen'; answer?: string; result?: 'correct' | 'wrong' },
  ) =>
    request<{ question: MistakeQuestion }>(`/api/jobs/${jobId}/questions/${qid}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  ask: (jobId: string, question: string, qid: string | null) =>
    request<{ answer: string }>(`/api/jobs/${jobId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question, qid }),
    }),
  getChat: (jobId: string, qid: string | null) =>
    request<{ messages: ChatMessage[] }>(`/api/jobs/${jobId}/chat${qid ? `?qid=${encodeURIComponent(qid)}` : ''}`),

  sendFeedback: (message: string, page: string, diag: Record<string, unknown>) =>
    request<{ id: number }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ message, page, diag }),
    }),
  listFeedback: () => request<{ feedback: Feedback[] }>('/api/admin/feedback'),
  deleteFeedback: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/feedback/${id}`, { method: 'DELETE' }),
  listReleases: () => request<{ releases: Release[] }>('/api/releases'),

  mistakes: (filters: MistakeFilters = {}) => {
    const search = new URLSearchParams()
    if (filters.studentId != null) search.set('student_id', String(filters.studentId))
    if (filters.paperId) search.set('paper_id', filters.paperId)
    if (filters.review && filters.review !== 'all') search.set('review', filters.review)
    if (filters.q?.trim()) search.set('q', filters.q.trim())
    if (filters.days) search.set('days', String(filters.days))
    return request<{ groups: { knowledge_point: string; questions: MistakeQuestion[] }[] }>(
      `/api/mistakes${search.size ? `?${search}` : ''}`,
    )
  },
  overview: (studentId?: number | null, days = 30) => {
    const search = new URLSearchParams({ days: String(days) })
    if (studentId != null) search.set('student_id', String(studentId))
    return request<Overview>(`/api/stats/overview?${search}`)
  },
}

export function pageImageUrl(jobId: string, n: number): string {
  return `/api/jobs/${jobId}/page/${n}`
}

export function paperPageImageUrl(paperId: string, n: number): string {
  return `/api/papers/${paperId}/page/${n}`
}
