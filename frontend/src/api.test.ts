import { expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

it('wraps response body transport failures in ApiError', async () => {
  const text = vi.fn().mockRejectedValue(new TypeError('stream interrupted'))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text }))

  const pending = api.me()
  await expect(pending).rejects.toBeInstanceOf(ApiError)
  await expect(pending).rejects.toMatchObject({
    status: 0,
    code: 'network',
    message: '网络连接中断，请检查网络后重试',
  })
})

it('preserves abort semantics when reading the response body is aborted', async () => {
  const text = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text }))

  await expect(api.me()).rejects.toMatchObject({ code: 'abort', status: 0 })
})
