import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

afterEach(() => vi.useRealTimers())

it('waits 300ms and restarts the delay when the input changes', () => {
  vi.useFakeTimers()
  const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), { initialProps: { value: '' } })

  rerender({ value: '数' })
  act(() => { vi.advanceTimersByTime(200) })
  rerender({ value: '数学' })
  act(() => { vi.advanceTimersByTime(299) })
  expect(result.current).toBe('')

  act(() => { vi.advanceTimersByTime(1) })
  expect(result.current).toBe('数学')
})
