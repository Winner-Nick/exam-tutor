import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { GuideRole } from './guideContent'
import type { User } from '../types'

const Onboarding = lazy(() => import('./Onboarding').then((module) => ({ default: module.Onboarding })))
const ProductTour = lazy(() => import('./ProductTour').then((module) => ({ default: module.ProductTour })))

interface StoredGuideState {
  onboardingSeen: boolean
  checklist: string[]
}

export interface GuideContextValue {
  user: User
  role: GuideRole
  hasSeenOnboarding: boolean
  isOnboardingOpen: boolean
  isTourActive: boolean
  checklist: string[]
  startTour: () => void
  openOnboarding: () => void
  closeOnboarding: () => void
  closeTour: () => void
  openGuide: (anchor?: string) => void
  toggleChecklist: (itemId: string) => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

function storageKey(userId: number): string {
  return `et-guide-v1:${userId}`
}

function readStoredState(userId: number): StoredGuideState {
  const fallback: StoredGuideState = { onboardingSeen: false, checklist: [] }
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback
    const record = parsed as Record<string, unknown>
    return {
      onboardingSeen: record.onboardingSeen === true,
      checklist: Array.isArray(record.checklist)
        ? record.checklist.filter((item): item is string => typeof item === 'string')
        : [],
    }
  } catch {
    return fallback
  }
}

function GuideSession({ user, children }: { user: User; children: ReactNode }) {
  const navigate = useNavigate()
  const [stored, setStored] = useState<StoredGuideState>(() => readStoredState(user.id))
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [tourActive, setTourActive] = useState(false)
  const [tourRun, setTourRun] = useState(0)
  const role: GuideRole = user.role === 'student' ? 'student' : 'teacher'

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(user.id), JSON.stringify(stored))
    } catch {
      // 存储被禁用时仍保留当前会话内的引导功能。
    }
  }, [stored, user.id])

  useEffect(() => {
    if (!stored.onboardingSeen) setOnboardingOpen(true)
  }, [stored.onboardingSeen])

  const markOnboardingSeen = useCallback(() => {
    setStored((current) => (current.onboardingSeen ? current : { ...current, onboardingSeen: true }))
  }, [])

  const closeOnboarding = useCallback(() => {
    markOnboardingSeen()
    setOnboardingOpen(false)
  }, [markOnboardingSeen])

  const openOnboarding = useCallback(() => {
    setTourActive(false)
    setOnboardingOpen(true)
  }, [])

  const startTour = useCallback(() => {
    markOnboardingSeen()
    setOnboardingOpen(false)
    setTourRun((current) => current + 1)
    setTourActive(true)
  }, [markOnboardingSeen])

  const closeTour = useCallback(() => setTourActive(false), [])

  const openGuide = useCallback(
    (anchor?: string) => {
      markOnboardingSeen()
      setOnboardingOpen(false)
      setTourActive(false)
      navigate(anchor ? `/guide#${encodeURIComponent(anchor)}` : '/guide')
    },
    [markOnboardingSeen, navigate],
  )

  const toggleChecklist = useCallback((itemId: string) => {
    setStored((current) => ({
      ...current,
      checklist: current.checklist.includes(itemId)
        ? current.checklist.filter((id) => id !== itemId)
        : [...current.checklist, itemId],
    }))
  }, [])

  const value = useMemo<GuideContextValue>(
    () => ({
      user,
      role,
      hasSeenOnboarding: stored.onboardingSeen,
      isOnboardingOpen: onboardingOpen,
      isTourActive: tourActive,
      checklist: stored.checklist,
      startTour,
      openOnboarding,
      closeOnboarding,
      closeTour,
      openGuide,
      toggleChecklist,
    }),
    [
      user,
      role,
      stored,
      onboardingOpen,
      tourActive,
      startTour,
      openOnboarding,
      closeOnboarding,
      closeTour,
      openGuide,
      toggleChecklist,
    ],
  )

  return (
    <GuideContext.Provider value={value}>
      {children}
      <Suspense fallback={<div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 text-sm text-white" role="status">正在加载引导内容…</div>}>
        {onboardingOpen && (
          <Onboarding
            user={user}
            onClose={closeOnboarding}
            onStartTour={startTour}
            onOpenGuide={() => openGuide()}
          />
        )}
        {tourActive && (
          <ProductTour
            key={`${tourRun}:${role}`}
            user={user}
            onClose={closeTour}
            onOpenGuide={openGuide}
          />
        )}
      </Suspense>
    </GuideContext.Provider>
  )
}

export function GuideProvider({ user, children }: { user: User; children: ReactNode }) {
  return <GuideSession key={user.id} user={user}>{children}</GuideSession>
}

export function useGuide(): GuideContextValue {
  const context = useContext(GuideContext)
  if (!context) throw new Error('useGuide 必须在 GuideProvider 内使用')
  return context
}
