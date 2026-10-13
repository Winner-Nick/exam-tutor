import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
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

  const push = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = nextId.current++
    setItems((xs) => [...xs, { id, text, kind }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pop-in flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
              t.kind === 'error' ? 'bg-rose-600' : 'bg-stone-800 dark:bg-stone-700'
            }`}
          >
            <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={15} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
