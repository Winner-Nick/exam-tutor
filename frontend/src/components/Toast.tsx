import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error'
}

const ToastCtx = createContext<(text: string, kind?: 'info' | 'error') => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef<Set<number>>(new Set())

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current.clear()
  }, [])

  const push = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = nextId.current++
    setItems((xs) => [...xs, { id, text, kind }])
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setItems((xs) => xs.filter((x) => x.id !== id))
    }, 3500)
    timers.current.add(timer)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pop-in flex max-w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3 text-sm font-medium text-ink shadow-xl sm:max-w-lg ${
              t.kind === 'error' ? 'border-rose-200 dark:border-rose-800' : 'border-line'
            }`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${t.kind === 'error' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
              <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={15} />
            </span>
            <span className="min-w-0 leading-5">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
