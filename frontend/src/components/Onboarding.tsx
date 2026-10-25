import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { ONBOARDING_SLIDES, type GuideRole } from './guideContent'
import type { User } from '../types'

interface OnboardingProps {
  user: User
  onClose: () => void
  onStartTour: () => void
  onOpenGuide: () => void
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Onboarding({ user, onClose, onStartTour, onOpenGuide }: OnboardingProps) {
  const role: GuideRole = user.role === 'student' ? 'student' : 'teacher'
  const slides = ONBOARDING_SLIDES[role]
  const [step, setStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const slide = slides[step]
  const isLast = step === slides.length - 1

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    headingRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
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
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="card thin-scroll max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto outline-none sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <div className="flex items-center gap-2.5">
            <span className="seal h-9 w-9">错</span>
            <div>
              <p className="text-xs font-medium text-primary-600 dark:text-primary-400">{slide.eyebrow}</p>
              <p className="text-xs text-dim">首次使用向导</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="稍后使用并关闭向导">
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <div className="mb-6 flex items-center gap-2" aria-label={`向导进度：第 ${step + 1} 步，共 ${slides.length} 步`}>
            {slides.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStep(index)}
                aria-label={`查看第 ${index + 1} 步：${item.title}`}
                aria-current={index === step ? 'step' : undefined}
                className={`h-2 rounded-full transition-all ${
                  index === step ? 'w-8 bg-primary-600' : index < step ? 'w-4 bg-primary-300' : 'w-4 bg-line'
                }`}
              />
            ))}
            <span className="ml-auto text-xs font-medium text-dim">
              {step + 1} / {slides.length}
            </span>
          </div>

          <div key={slide.id} className="fade-up">
            <h2 ref={headingRef} id={titleId} tabIndex={-1} className="font-serif text-2xl font-bold outline-none sm:text-3xl">
              {slide.title}
            </h2>
            <p id={descriptionId} className="mt-3 text-sm leading-7 text-ink2 sm:text-base">
              {slide.description}
            </p>

            {slide.features && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {slide.features.map((feature) => (
                  <div key={feature.title} className="rounded-2xl border border-line bg-surface-2/60 p-4">
                    <div className="flex items-center gap-2 font-semibold">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                        <Icon name={feature.icon} size={17} />
                      </span>
                      {feature.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink2">{feature.text}</p>
                  </div>
                ))}
              </div>
            )}

            {slide.steps && (
              <ol className="mt-6 space-y-4">
                {slide.steps.map((item, index) => (
                  <li key={item.title} className="flex gap-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 font-serif text-sm font-bold text-white">
                      {index + 1}
                    </span>
                    <div className="pt-0.5">
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-ink2">{item.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {slide.notices && (
              <div className="mt-6 space-y-3">
                {slide.notices.map((notice, index) => (
                  <div
                    key={notice.title}
                    className={`flex gap-3 rounded-2xl border p-4 ${
                      index === 0
                        ? 'border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/20'
                        : 'border-line bg-surface-2/60'
                    }`}
                  >
                    <Icon
                      name={index === 0 ? 'alert' : index === 1 ? 'upload' : 'eye'}
                      size={18}
                      className={`mt-0.5 ${index === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary-600 dark:text-primary-400'}`}
                    />
                    <div>
                      <h3 className="text-sm font-semibold">{notice.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-ink2">{notice.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line bg-surface-2/40 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={onOpenGuide} className="btn-ghost px-2 py-1.5 text-sm">
              <Icon name="book-open" size={16} /> 打开完整教程
            </button>
            <button type="button" onClick={onClose} className="btn-ghost px-2 py-1.5 text-sm text-dim">
              稍后使用
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
              className="btn-outline px-4 py-2.5"
            >
              <Icon name="arrow-left" size={16} /> 上一步
            </button>
            {isLast ? (
              <button type="button" onClick={onStartTour} className="btn-primary px-5 py-2.5">
                <Icon name="target" size={17} /> 开始页面导览
              </button>
            ) : (
              <button type="button" onClick={() => setStep((current) => Math.min(slides.length - 1, current + 1))} className="btn-primary px-5 py-2.5">
                下一步 <Icon name="arrow-right" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
