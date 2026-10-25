import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { expect, it } from 'vitest'
import { useSerialTasks } from './useSerialTasks'

it('tracks busy correctly after StrictMode re-runs effects', async () => {
  let resolveTask: ((value: string) => void) | undefined
  const task = new Promise<string>((resolve) => { resolveTask = resolve })
  const { result } = renderHook(() => useSerialTasks(), {
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  })

  let pending: Promise<string>
  act(() => {
    pending = result.current.enqueue(() => task)
  })
  await waitFor(() => expect(result.current.busy).toBe(true))

  await act(async () => {
    resolveTask?.('done')
    await expect(pending!).resolves.toBe('done')
  })
  expect(result.current.busy).toBe(false)
})
