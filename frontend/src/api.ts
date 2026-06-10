import type {
  ChatMessage,
  Invite,
  Job,
  JobStats,
  Paper,
  PaperQuestion,
  Question,
  Release,
  Student,
  User,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') detail = data.detail
    } catch {
      /* 保留默认错误信息 */
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export const api = {
  // auth
  me: () => request<User>('/api/auth/me'),
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
    request<{ ok: boolean }>(`/api/admin/invites/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),

  // students
  listStudents: () => request<{ students: Student[] }>('/api/students'),
  createStudent: (name: string) =>
    request<Student>('/api/students', { method: 'POST', body: JSON.stringify({ name }) }),
  renameStudent: (id: number, name: string) =>
    request<Student>(`/api/students/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteStudent: (id: number) =>
    request<{ ok: boolean }>(`/api/students/${id}`, { method: 'DELETE' }),

  // papers（试卷库）
  listPapers: () => request<{ papers: Paper[] }>('/api/papers'),
  getPaper: (id: string) => request<Paper>(`/api/papers/${id}`),
  createPaper: (files: File[], title: string | null) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    if (title) fd.append('title', title)
    return request<{ paper_id: string }>('/api/papers', { method: 'POST', body: fd })
  },
  addPaperFiles: (id: string, files: File[], kind: 'answers' | 'questions' | 'mixed') => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    fd.append('kind', kind)
    return request<{ ok: boolean }>(`/api/papers/${id}/files`, { method: 'POST', body: fd })
  },
  renamePaper: (id: string, title: string) =>
    request<Paper>(`/api/papers/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  createManualPaper: (title: string) =>
    request<{ paper_id: string }>('/api/papers/manual', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  addPaperQuestion: (id: string, body: { number: string; correct_answer?: string | null; type?: string | null }) =>
    request<PaperQuestion>(`/api/papers/${id}/questions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deletePaperQuestion: (id: string, qid: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/questions/${qid}`, { method: 'DELETE' }),
  deletePaper: (id: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}`, { method: 'DELETE' }),
  reprocessPaper: (id: string) =>
    request<{ ok: boolean }>(`/api/papers/${id}/reprocess`, { method: 'POST', body: '{}' }),
  setPaperAnswer: (id: string, qid: string, correct_answer: string | null) =>
    request<{ question: PaperQuestion; regraded: number }>(`/api/papers/${id}/questions/${qid}`, {
      method: 'PATCH',
      body: JSON.stringify({ correct_answer }),
    }),

  // submissions（批改记录，沿用 jobs 资源）
  listJobs: (studentId?: number | null, paperId?: string | null) => {
    const p = new URLSearchParams()
    if (studentId != null) p.set('student_id', String(studentId))
    if (paperId != null) p.set('paper_id', paperId)
    const qs = p.toString()
    return request<{ jobs: Job[] }>(`/api/jobs${qs ? `?${qs}` : ''}`)
  },
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  deleteJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  createSubmission: (paperId: string, studentId: number, files: File[], usePaperFiles = false) => {
    const fd = new FormData()
    fd.append('paper_id', paperId)
    fd.append('student_id', String(studentId))
    files.forEach((f) => fd.append('files', f))
    if (usePaperFiles) fd.append('use_paper_files', 'true')
    return request<{ job_id: string }>('/api/submissions', { method: 'POST', body: fd })
  },
  addSubmissionFiles: (jobId: string, files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    return request<{ ok: boolean }>(`/api/jobs/${jobId}/files`, { method: 'POST', body: fd })
  },

  // questions
  override: (jobId: string, qid: string, body: { student_answer?: string | null; status?: string }) =>
    request<{ question: Question; stats: JobStats }>(
      `/api/jobs/${jobId}/questions/${qid}/override`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  requestExplain: (jobId: string, qid: string) =>
    request<{ explain_state: string }>(`/api/jobs/${jobId}/questions/${qid}/explain`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // chat
  ask: (jobId: string, question: string, qid: string | null) =>
    request<{ answer: string }>(`/api/jobs/${jobId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question, qid }),
    }),
  getChat: (jobId: string, qid: string | null) =>
    request<{ messages: ChatMessage[] }>(
      `/api/jobs/${jobId}/chat${qid ? `?qid=${encodeURIComponent(qid)}` : ''}`,
    ),

  // App 安装包发布页（公开，无需登录）
  listReleases: () => request<{ releases: Release[] }>('/api/releases'),

  // 聚合（可按学生过滤）
  mistakes: (studentId?: number | null) =>
    request<{ groups: { knowledge_point: string; questions: (Question & { job_id: string; job_title: string; student_name: string | null })[] }[] }>(
      `/api/mistakes${studentId != null ? `?student_id=${studentId}` : ''}`,
    ),
  overview: (studentId?: number | null) =>
    request<{
      jobs: { id: string; title: string; student_name: string | null; created_at: number; stats: Partial<JobStats> }[]
      knowledge_points: { knowledge_point: string; wrong: number; total: number }[]
    }>(`/api/stats/overview${studentId != null ? `?student_id=${studentId}` : ''}`),
}

export function pageImageUrl(jobId: string, n: number): string {
  return `/api/jobs/${jobId}/page/${n}`
}

export function paperPageImageUrl(paperId: string, n: number): string {
  return `/api/papers/${paperId}/page/${n}`
}
