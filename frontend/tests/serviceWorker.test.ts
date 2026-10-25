import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/sw.js', 'utf8')
const origin = 'https://example.test'

function setup() {
  const stores = new Map<string, Map<string, unknown>>()
  const listeners = new Map<string, (event: any) => void>()
  const keyOf = (request: any) => typeof request === 'string' ? request : request.url
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      addAll: vi.fn(async (urls: string[]) => { urls.forEach((url) => store.set(keyOf(url), { url })) }),
      match: vi.fn(async (request: any) => store.get(keyOf(request))),
      put: vi.fn(async (request: any, response: unknown) => { store.set(keyOf(request), response) }),
      keys: vi.fn(async () => Array.from(store.keys())),
      delete: vi.fn(async (request: any) => store.delete(keyOf(request))),
    }
  }
  const caches = {
    open: vi.fn(open),
    keys: vi.fn(async () => Array.from(stores.keys())),
    delete: vi.fn(async (name: string) => stores.delete(name)),
    match: vi.fn(async (request: any) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(request))
        if (hit) return hit
      }
      return undefined
    }),
  }
  const fetchMock = vi.fn()
  const self = {
    location: { origin },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
  }
  runInNewContext(source, { self, caches, fetch: fetchMock, URL, Set, Promise })

  async function install() {
    const event = { waitUntil: vi.fn() }
    listeners.get('install')!(event)
    await event.waitUntil.mock.calls[0][0]
  }

  function dispatch(request: any) {
    const event = { request, respondWith: vi.fn(), waitUntil: vi.fn() }
    listeners.get('fetch')!(event)
    return {
      event,
      response: event.respondWith.mock.calls[0]?.[0] as Promise<unknown> | undefined,
      lifetime: event.waitUntil.mock.calls.map(([promise]) => promise),
    }
  }

  return { stores, listeners, caches, fetchMock, self, open, install, dispatch }
}

describe('service worker cache lifecycle', () => {
  it('installs the offline script and keeps navigation fallback working', async () => {
    const worker = setup()
    await worker.install()
    expect(worker.stores.get('exam-tutor-shell-v2')?.has('/offline.js')).toBe(true)
    worker.fetchMock.mockRejectedValue(new TypeError('offline'))

    const event = worker.dispatch({ method: 'GET', mode: 'navigate', url: `${origin}/papers` })

    await expect(event.response).resolves.toEqual({ url: '/offline.html' })
  })

  it('deletes old app cache versions without touching unrelated caches', async () => {
    const worker = setup()
    await worker.open('exam-tutor-shell-v1')
    await worker.open('exam-tutor-runtime-v0')
    await worker.open('unrelated-cache')
    const event = { waitUntil: vi.fn() }

    worker.listeners.get('activate')!(event)
    await event.waitUntil.mock.calls[0][0]

    expect(worker.stores.has('exam-tutor-shell-v1')).toBe(false)
    expect(worker.stores.has('exam-tutor-runtime-v0')).toBe(false)
    expect(worker.stores.has('unrelated-cache')).toBe(true)
    expect(worker.self.clients.claim).toHaveBeenCalledOnce()
  })

  it('includes runtime cache writes in the fetch event lifetime', async () => {
    const worker = setup()
    const copy = { cloned: true }
    const response = { ok: true, clone: vi.fn(() => copy) }
    worker.fetchMock.mockResolvedValue(response)
    const request = { method: 'GET', mode: 'cors', url: `${origin}/assets/app.js` }

    const event = worker.dispatch(request)
    await expect(event.response).resolves.toBe(response)
    await Promise.all(event.lifetime)

    expect(event.event.waitUntil).toHaveBeenCalledOnce()
    expect(response.clone).toHaveBeenCalledOnce()
    expect(worker.stores.get('exam-tutor-runtime-v1')?.get(request.url)).toBe(copy)
  })

  it('evicts the oldest runtime entries beyond the cache limit', async () => {
    const worker = setup()
    const runtime = await worker.open('exam-tutor-runtime-v1')
    for (let index = 0; index < 50; index += 1) {
      await runtime.put({ url: `${origin}/assets/old-${index}.js` }, { index })
    }
    const response = { ok: true, clone: vi.fn(() => ({ current: true })) }
    worker.fetchMock.mockResolvedValue(response)
    const request = { method: 'GET', mode: 'cors', url: `${origin}/assets/new.js` }

    const event = worker.dispatch(request)
    await event.response
    await Promise.all(event.lifetime)

    const store = worker.stores.get('exam-tutor-runtime-v1')!
    expect(store.size).toBe(50)
    expect(store.has(`${origin}/assets/old-0.js`)).toBe(false)
    expect(store.has(request.url)).toBe(true)
  })

  it('continues to bypass API requests', () => {
    const worker = setup()
    for (const path of ['/api', '/api/jobs']) {
      const event = worker.dispatch({ method: 'GET', mode: 'cors', url: `${origin}${path}` })
      expect(event.event.respondWith).not.toHaveBeenCalled()
      expect(event.event.waitUntil).not.toHaveBeenCalled()
    }
    expect(worker.fetchMock).not.toHaveBeenCalled()
  })
})
