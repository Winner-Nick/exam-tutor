import { expect, it, vi } from 'vitest'
import { api } from './api'

function mockFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(payload) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('serializes mistakes pagination including an explicit limit=0 export', async () => {
  const fetchMock = mockFetch({ groups: [], total: 0, limit: 0, offset: 0 })
  await api.mistakes({ q: '代数', limit: 0, offset: 0 })

  const url = fetchMock.mock.calls[0][0] as string
  expect(url).toContain('/api/mistakes?')
  expect(url).toContain('q=%E4%BB%A3%E6%95%B0')
  expect(url).toContain('limit=0')
  expect(url).toContain('offset=0')
})

it('serializes overview job pagination and chat history cursors', async () => {
  const fetchMock = mockFetch({ messages: [], has_more: false })
  await api.overview(null, 30, { jobLimit: 50, jobOffset: 100 })
  await api.getChat('job-1', 'q-1', { limit: 50, beforeId: 42 })

  expect(fetchMock.mock.calls[0][0]).toContain('job_limit=50')
  expect(fetchMock.mock.calls[0][0]).toContain('job_offset=100')
  expect(fetchMock.mock.calls[1][0]).toContain('qid=q-1')
  expect(fetchMock.mock.calls[1][0]).toContain('limit=50')
  expect(fetchMock.mock.calls[1][0]).toContain('before_id=42')
})
