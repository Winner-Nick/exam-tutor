import { useCallback, useEffect, useRef, useState } from 'react'

export function useSerialTasks() {
  const chain = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => () => {
    mounted.current = false
  }, [])

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    pending.current += 1
    if (mounted.current) setBusy(true)
    const result = chain.current.then(task, task)
    chain.current = result.then(() => undefined, () => undefined)
    return result.finally(() => {
      pending.current -= 1
      if (mounted.current && pending.current === 0) setBusy(false)
    })
  }, [])

  return { busy, enqueue }
}
