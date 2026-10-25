import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { TOUR_STEPS, type GuideRole } from './guideContent'
import type { User } from '../types'

interface ProductTourProps {
  user: User
  onClose: () => void
  onOpenGuide: (anchor?: string) => void
}

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function visibleTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const candidates = document.querySelectorAll<HTMLElement>(selector)
    for (const candidate of candidates) {
      const bounds = candidate.getBoundingClientRect()
      const style = window.getComputedStyle(candidate)
      if (
        bounds.width > 0 &&
        bounds.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        candidate.getAttribute('aria-hidden') !== 'true'
      ) {
        return candidate
      }
    }
  }
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function ProductTour({ user, onClose, onOpenGuide }: ProductTourProps) {
  const role: GuideRole = user.role === 'student' ? 'student' : 'teacher'
  const steps = TOUR_STEPS[role]
  const [stepIndex, setStepIndex] = useState(0)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [missing, setMissing] = useState(false)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [panelHeight, setPanelHeight] = useState(260)
  const targetRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const titleId = useId()
  const descriptionId = useId()
  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  function goNext() {
    if (isLast) onClose()
    else setStepIndex((current) => Math.min(steps.length - 1, current + 1))
  }

  function goPrevious() {
    setStepIndex((current) => Math.max(0, current - 1))
  }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    headingRef.current?.focus()
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [stepIndex])

  useEffect(() => {
    if (location.pathname !== step.path) navigate(step.path, { replace: true })
  }, [location.pathname, navigate, step.path])

  useEffect(() => {
    targetRef.current = null
    setTarget(null)
    setRect(null)
    setMissing(false)
    if (location.pathname !== step.path) return

    let stopped = false
    const startedAt = Date.now()
    const applyTarget = (next: HTMLElement | null) => {
      if (stopped) return
      targetRef.current = next
      setTarget(next)
      if (next) setMissing(false)
      else if (Date.now() - startedAt >= 1400) setMissing(true)
    }
    const resolve = () => applyTarget(visibleTarget(step.selectors))
    const frame = window.requestAnimationFrame(resolve)
    const timeout = window.setTimeout(() => {
      if (!targetRef.current) setMissing(true)
    }, 1400)
    const observer = new MutationObserver(resolve)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'data-tour'],
    })
    return () => {
      stopped = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      observer.disconnect()
    }
  }, [location.pathname, step])

  useEffect(() => {
    let frame = 0
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (target?.isConnected) {
          const bounds = target.getBoundingClientRect()
          const next = { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }
          setRect((current) =>
            current &&
            Math.abs(current.top - next.top) < 0.5 &&
            Math.abs(current.left - next.left) < 0.5 &&
            Math.abs(current.width - next.width) < 0.5 &&
            Math.abs(current.height - next.height) < 0.5
              ? current
              : next,
          )
        } else {
          setRect(null)
        }
        if (panelRef.current) {
          const height = panelRef.current.offsetHeight
          setPanelHeight((current) => (current === height ? current : height))
        }
      })
    }

    if (target) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
    }
    update()
    const settleTimer = window.setTimeout(update, 350)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (target) resizeObserver?.observe(target)
    if (panelRef.current) resizeObserver?.observe(panelRef.current)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      resizeObserver?.disconnect()
    }
  }, [missing, stepIndex, target])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'Tab' && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (items.length === 0) {
          event.preventDefault()
          panelRef.current.focus()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        const activeIndex = items.indexOf(document.activeElement as HTMLElement)
        if (activeIndex === -1) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'ArrowLeft' && stepIndex > 0) {
        event.preventDefault()
        goPrevious()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  let panelStyle: CSSProperties | undefined
  if (rect) {
    if (window.innerWidth < 640) {
      panelStyle = {
        left: 12,
        right: 12,
        bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        maxHeight: 'calc(100dvh - 1.5rem)',
      }
    } else {
      const width = Math.min(400, window.innerWidth - 24)
      const left = Math.min(
        window.innerWidth - width - 12,
        Math.max(12, rect.left + rect.width / 2 - width / 2),
      )
      const below = rect.top + rect.height + 18
      const above = rect.top - panelHeight - 18
      const preferAbove = below + panelHeight > window.innerHeight - 12 && above >= 12
      const desiredTop = preferAbove ? above : below
      const top = Math.min(window.innerHeight - panelHeight - 12, Math.max(12, desiredTop))
      panelStyle = { top, left, width, maxHeight: 'calc(100dvh - 1.5rem)' }
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] ${rect ? '' : 'flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm'}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-2xl border-2 border-primary-400 transition-[top,left,width,height] duration-150"
          style={{
            top: rect.top - 7,
            left: rect.left - 7,
            width: rect.width + 14,
            height: rect.height + 14,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.52), 0 0 0 5px rgb(196 82 44 / 0.18)',
          }}
        />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-keyshortcuts="ArrowLeft ArrowRight Escape"
        tabIndex={-1}
        className={`card thin-scroll overflow-y-auto p-5 shadow-2xl outline-none ${
          rect ? 'fixed' : 'relative w-full max-w-md'
        }`}
        style={panelStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="badge bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            <Icon name="target" size={14} /> {role === 'teacher' ? '老师' : '学生'}页面导览
          </span>
          <button type="button" onClick={onClose} className="btn-ghost px-2 py-1 text-xs" aria-label="跳过并关闭页面导览">
            跳过 <Icon name="x" size={15} />
          </button>
        </div>

        <div className="mt-5">
          {!target && (
            <div
              className={`mb-4 flex gap-2.5 rounded-xl border p-3 text-sm leading-6 ${
                missing
                  ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200'
                  : 'border-line bg-surface-2 text-ink2'
              }`}
              role={missing ? 'status' : undefined}
            >
              {missing ? <Icon name="alert" size={18} className="mt-1 shrink-0" /> : <Spinner className="mt-1 h-4 w-4 shrink-0" />}
              <p>
                {missing
                  ? '这一步的页面目标暂时不存在，可能是还没有数据或界面已变化。下面说明仍然有效，可以直接继续。'
                  : '正在进入对应页面并寻找可高亮的控件…'}
              </p>
            </div>
          )}
          <h2 ref={headingRef} id={titleId} tabIndex={-1} className="font-serif text-xl font-bold outline-none">
            {step.title}
          </h2>
          <p id={descriptionId} className="mt-2.5 text-sm leading-6 text-ink2">
            {step.description}
          </p>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-dim">
            <span>
              第 {stepIndex + 1} 步，共 {steps.length} 步
            </span>
            <span className="hidden sm:inline">← / → 切换 · Esc 跳过</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label="页面导览进度"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={stepIndex + 1}
          >
            <div
              className="h-full rounded-full bg-primary-600 transition-[width]"
              style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => onOpenGuide(step.guideAnchor)} className="btn-ghost px-2 py-2 text-sm">
            <Icon name="book-open" size={16} /> 查看教程
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrevious} disabled={stepIndex === 0} className="btn-outline px-3 py-2">
              <Icon name="arrow-left" size={16} /> 上一步
            </button>
            <button type="button" onClick={goNext} className="btn-primary px-4 py-2">
              {isLast ? '完成导览' : '下一步'} <Icon name={isLast ? 'check' : 'arrow-right'} size={16} />
            </button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          当前第 {stepIndex + 1} 步：{step.title}
        </p>
      </div>
    </div>,
    document.body,
  )
}
