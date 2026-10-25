import { expect, it, vi } from 'vitest'
import { api } from './api'

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []
  upload: { onprogress?: (event: ProgressEvent) => void } = {}
  responseText = ''
  status = 200
  timeout = 0
  withCredentials = false
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => this.onabort?.())

  constructor() {
    FakeXMLHttpRequest.instances.push(this)
  }
}

function setup() {
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
}

function latest() {
  return FakeXMLHttpRequest.instances[FakeXMLHttpRequest.instances.length - 1]!
}

it('sends the idempotency key header for uploads', async () => {
  setup()
  const promise = api.createPaper([new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })], null, { idempotencyKey: 'form-key' })
  const xhr = latest()
  xhr.status = 201
  xhr.responseText = '{"paper_id":"paper-1"}'
  xhr.onload?.()

  await expect(promise).resolves.toEqual({ paper_id: 'paper-1' })
  expect(xhr.setRequestHeader).toHaveBeenCalledWith('Idempotency-Key', 'form-key')
})

for (const event of ['onabort', 'ontimeout'] as const) {
  it(`uses uncertain-result wording for ${event}`, async () => {
    setup()
    const promise = api.createSubmission('paper', 1, [], false)
    const xhr = latest()
    xhr[event]?.()

    await expect(promise).rejects.toMatchObject({
      message: '已停止等待，请检查记录是否已创建',
      code: event === 'onabort' ? 'abort' : 'timeout',
    })
  })
}

it('passes React Query signals through fetch requests', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"messages":[]}' })
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()

  await api.getChat('job', null, { signal: controller.signal })

  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
})
