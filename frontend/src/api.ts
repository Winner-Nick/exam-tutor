import type { ChatMessage, Job, Question, JobStats, User } from './types'

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
  createInvite: () =>
    request<{ code: string }>('/api/admin/invites', { method: 'POST', body: JSON.stringify({}) }),

  // jobs
  listJobs: () => request<{ jobs: Job[] }>('/api/jobs'),
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  deleteJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ job_id: string }>('/api/upload', { method: 'POST', body: fd })
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

  // 阶段7：聚合
  mistakes: () => request<{ groups: { knowledge_point: string; questions: (Question & { job_id: string; job_title: string })[] }[] }>('/api/mistakes'),
  overview: () =>
    request<{
      jobs: { id: string; title: string; created_at: number; stats: Partial<JobStats> }[]
      knowledge_points: { knowledge_point: string; wrong: number; total: number }[]
    }>('/api/stats/overview'),
}

export function pageImageUrl(jobId: string, n: number): string {
  return `/api/jobs/${jobId}/page/${n}`
}
