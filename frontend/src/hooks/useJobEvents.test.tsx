import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { api, ApiError } from '../api'
import { useJobEvents } from './useJobEvents'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  private listeners = new Map<string, ((event: Event) => void)[]>()
  close = vi.fn()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, data?: string) {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function setup() {
  vi.stubGlobal('EventSource', FakeEventSource)
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const view = renderHook(() => useJobEvents('job-1'), { wrapper })
  return { qc, view, source: FakeEventSource.instances[FakeEventSource.instances.length - 1]! }
}

it('checks the session once after consecutive failures and recovers on open', async () => {
  const me = vi.spyOn(api, 'me').mockRejectedValue(new ApiError(0, 'offline', 'network'))
  const { view, source } = setup()

  act(() => source.emit('error'))
  expect(me).not.toHaveBeenCalled()
  act(() => source.emit('error'))
  expect(me).toHaveBeenCalledOnce()
  expect(view.result.current.sseDown).toBe(true)
  act(() => source.emit('error'))
  expect(me).toHaveBeenCalledOnce()

  act(() => source.emit('open'))
  expect(view.result.current.sseDown).toBe(false)
  act(() => { source.emit('error'); source.emit('error') })
  expect(me).toHaveBeenCalledTimes(2)
  await act(async () => { await Promise.resolve() })
})

it('refreshes on malformed snapshot and progress JSON without throwing', () => {
  const { qc, source } = setup()
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)

  expect(() => {
    source.emit('snapshot', '{bad json')
    source.emit('progress', 'not json')
  }).not.toThrow()

  expect(invalidate).toHaveBeenCalledTimes(2)
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['job', 'job-1'] })
})
