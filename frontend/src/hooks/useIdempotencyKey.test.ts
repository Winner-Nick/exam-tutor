import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useIdempotencyKey } from './useIdempotencyKey'

it('keeps the key across identical forms and rotates it for input changes and success', () => {
  const file = new File(['pdf'], 'answer.pdf', { type: 'application/pdf' })
  const files = [file]
  const { result, rerender } = renderHook(({ inputs }) => useIdempotencyKey(inputs), {
    initialProps: { inputs: [files, 'paper', 'title'] as readonly unknown[] },
  })
  const initial = result.current.key

  rerender({ inputs: [files, 'paper', 'title'] })
  expect(result.current.key).toBe(initial)

  rerender({ inputs: [[file], 'paper', 'title'] })
  expect(result.current.key).not.toBe(initial)
  const changed = result.current.key
  rerender({ inputs: [[file], 'paper', 'renamed'] })
  expect(result.current.key).not.toBe(changed)

  const beforeSuccess = result.current.key
  act(() => result.current.regenerate())
  rerender({ inputs: [[file], 'paper', 'renamed'] })
  expect(result.current.key).not.toBe(beforeSuccess)
})
