import { useCallback, useRef } from 'react'

export function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ??
    `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function useIdempotencyKey(inputs: readonly unknown[]) {
  const key = useRef('')
  const previous = useRef<readonly unknown[]>([])
  const changed = inputs.length !== previous.current.length ||
    inputs.some((value, index) => !Object.is(value, previous.current[index]))

  if (!key.current || changed) {
    key.current = createIdempotencyKey()
    previous.current = [...inputs]
  }

  const regenerate = useCallback(() => {
    key.current = createIdempotencyKey()
  }, [])

  return { key: key.current, regenerate }
}
