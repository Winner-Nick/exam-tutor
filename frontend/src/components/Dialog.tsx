import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({
  title,
  children,
  onClose,
  className = 'max-w-md',
  hideClose = false,
  preventClose = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
  hideClose?: boolean
  preventClose?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef({ onClose, blocked: hideClose || preventClose })
  closeRef.current = { onClose, blocked: hideClose || preventClose }

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE)
    ;(first ?? panel)?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!closeRef.current.blocked) closeRef.current.onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const panel = panelRef.current
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (active === panel || !panel.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? lastItem : firstItem).focus()
      } else if (event.shiftKey && active === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = oldOverflow
      previous?.focus()
    }
  }, [])

  const backdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !hideClose && !preventClose) onClose()
  }

  return createPortal(
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[3px] sm:p-6" onMouseDown={backdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`dialog-panel pop-in card thin-scroll max-h-[90dvh] w-full overflow-y-auto p-6 shadow-2xl outline-none ${className}`}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-serif text-xl font-bold text-ink">{title}</h2>
          {!hideClose && (
            <button onClick={onClose} disabled={preventClose} className="icon-btn -mt-2 -mr-2" aria-label="关闭对话框">
              <Icon name="x" size={19} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
