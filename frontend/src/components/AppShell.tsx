import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useUi } from '../store'
import type { User } from '../types'
import { Dialog } from './Dialog'
import { FeedbackDialog } from './FeedbackDialog'
import { GuideProvider, useGuide } from './GuideProvider'
import { Icon, type IconName } from './Icon'

interface NavItem {
  to: string
  label: string
  icon: IconName
  end?: boolean
}

const teacherNav: NavItem[] = [
  { to: '/', label: '拍照批改', icon: 'pen', end: true },
  { to: '/papers', label: '试卷库', icon: 'book' },
  { to: '/students', label: '学生管理', icon: 'users' },
  { to: '/mistakes', label: '错题复习', icon: 'bookmark' },
  { to: '/stats', label: '学习统计', icon: 'chart' },
  { to: '/guide', label: '使用教程', icon: 'book-open' },
  { to: '/settings', label: '账号设置', icon: 'settings' },
]

const studentNav: NavItem[] = [
  { to: '/', label: '我的批改', icon: 'pen', end: true },
  { to: '/mistakes', label: '错题复习', icon: 'bookmark' },
  { to: '/stats', label: '学习统计', icon: 'chart' },
  { to: '/guide', label: '使用教程', icon: 'book-open' },
  { to: '/settings', label: '账号设置', icon: 'settings' },
]

function itemActive(item: NavItem, pathname: string) {
  if (item.to === '/' && pathname.startsWith('/jobs/')) return true
  return item.end ? pathname === item.to : pathname.startsWith(item.to)
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" aria-label="错题家教首页" className="flex shrink-0 items-center gap-3 rounded-xl">
      <span className={`seal ${compact ? 'h-9 w-9 text-base' : 'h-10 w-10 text-lg'}`}>错</span>
      <span>
        <span className={`block font-serif font-bold text-ink ${compact ? 'text-base' : 'text-lg'}`}>错题家教</span>
        {!compact && <span className="mt-0.5 block text-[9px] font-semibold tracking-[0.22em] text-dim">EXAM TUTOR</span>}
      </span>
    </Link>
  )
}

function Shell({ user, children }: { user: User; children: ReactNode }) {
  const theme = useUi((state) => state.theme)
  const toggleTheme = useUi((state) => state.toggleTheme)
  const { startTour } = useGuide()
  const [showFeedback, setShowFeedback] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const isJob = location.pathname.startsWith('/jobs/')
  const navItems = user.role === 'student' ? studentNav : teacherNav
  const mobilePaths = user.role === 'student' ? ['/', '/mistakes', '/stats', '/settings'] : ['/', '/papers', '/mistakes', '/stats']
  const mobileItems = mobilePaths.map((path) => navItems.find((item) => item.to === path)!).filter(Boolean)
  const secondaryItems = navItems.filter((item) => !mobilePaths.includes(item.to))
  const moreActive = secondaryItems.some((item) => itemActive(item, location.pathname))

  useEffect(() => {
    setMenuOpen(false)
    if (!location.hash) {
      document.scrollingElement?.scrollTo?.({ top: 0, behavior: 'auto' })
      return
    }
    let id = ''
    try {
      id = decodeURIComponent(location.hash.slice(1))
    } catch {
      return
    }
    let attempts = 0
    let timer = 0
    const locate = () => {
      const target = document.getElementById(id)
      if (target) {
        target.scrollIntoView?.({ block: 'start', behavior: 'auto' })
        return
      }
      attempts += 1
      if (attempts < 40) timer = window.setTimeout(locate, 50)
    }
    timer = window.setTimeout(locate, 0)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.hash])

  const themeButton = (expanded = false) => (
    <button
      onClick={toggleTheme}
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      aria-label="切换深浅主题"
      className={expanded ? 'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink2 transition-colors hover:bg-surface-2 hover:text-ink' : 'icon-btn'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
      {expanded && <><span className="flex-1 text-left">{theme === 'dark' ? '浅色模式' : '深色模式'}</span><span className="text-xs text-dim">{theme === 'dark' ? '跟随当前深色主题' : '护眼夜间阅读'}</span></>}
    </button>
  )

  return (
    <div className="min-h-dvh bg-paper">
      <a href="#main-content" className="sr-only z-[100] rounded-xl bg-surface px-4 py-3 text-sm font-semibold shadow-xl focus:not-sr-only focus:fixed focus:top-3 focus:left-3">跳到主要内容</a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex xl:w-64">
        <div className="flex h-24 items-center px-5"><Brand /></div>
        <div className="px-4">
          <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.18em] text-dim">学习工作台</p>
          <nav data-tour="main-nav" aria-label="主导航" className="space-y-1">
            {navItems.map((item) => {
              const active = itemActive(item, location.pathname)
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex min-h-12 items-center gap-3 rounded-xl border px-3.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-primary-100 bg-primary-50 text-primary-800 dark:border-primary-900/60 dark:bg-primary-950/35 dark:text-primary-200'
                      : 'border-transparent text-ink2 hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <Icon name={item.icon} size={19} strokeWidth={active ? 2 : 1.7} />
                  <span className="flex-1">{item.label}</span>
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-primary-500" aria-hidden="true" />}
                </NavLink>
              )
            })}
          </nav>
        </div>
        <div className="mt-auto space-y-1 border-t border-line p-4">
          <button onClick={startTour} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink2 transition-colors hover:bg-surface-2 hover:text-ink"><Icon name="target" size={18} />页面导览</button>
          <button onClick={() => setShowFeedback(true)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink2 transition-colors hover:bg-surface-2 hover:text-ink"><Icon name="megaphone" size={18} />问题反馈</button>
          {themeButton(true)}
          <Link to="/settings" className="mt-2 flex items-center gap-3 rounded-2xl border border-line/70 bg-surface-2/50 p-3 transition-colors hover:border-line-strong">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 font-serif text-sm font-bold text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">{user.username.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{user.username}</span><span className="mt-0.5 block text-xs text-dim">{user.role === 'admin' ? '管理员' : user.role === 'student' ? '学生账号' : '老师账号'}</span></span>
            <Icon name="chevron-right" size={15} className="text-dim" />
          </Link>
        </div>
      </aside>

      <div className="app-main min-h-dvh lg:pl-60 xl:pl-64">
        <header className="app-topbar sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
            <Brand compact />
            <span className="flex-1" />
            <button onClick={() => setShowFeedback(true)} title="问题反馈" aria-label="问题反馈" className="icon-btn hidden sm:inline-flex"><Icon name="megaphone" size={19} /></button>
            {themeButton()}
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className={`mx-auto w-full min-w-0 px-4 pt-6 outline-none sm:px-6 sm:pt-8 lg:px-8 ${isJob ? 'max-w-[1600px] pb-24' : 'max-w-7xl pb-28'} lg:pb-10`}>
          {children}
        </main>
      </div>

      {!isJob && (
        <nav data-tour="main-nav" aria-label="移动端主导航" className="mobile-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 px-1 pt-1.5 shadow-[0_-8px_30px_-20px_rgb(0_0_0/0.35)] backdrop-blur-xl lg:hidden">
          {mobileItems.map((item) => {
            const active = itemActive(item, location.pathname)
            return (
              <NavLink key={item.to} to={item.to} end={item.end} aria-current={active ? 'page' : undefined} className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[11px] font-medium transition-colors ${active ? 'text-primary-700 dark:text-primary-300' : 'text-dim hover:text-ink'}`}>
                <Icon name={item.icon} size={20} strokeWidth={active ? 2.2 : 1.7} />
                <span className="max-w-full truncate">{item.to === '/mistakes' ? '错题' : item.to === '/settings' ? '我的' : item.label}</span>
                {active && <span className="absolute top-0 h-0.5 w-5 rounded-full bg-primary-500" aria-hidden="true" />}
              </NavLink>
            )
          })}
          <button onClick={() => setMenuOpen(true)} aria-label="打开更多功能" aria-expanded={menuOpen} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[11px] font-medium ${moreActive ? 'text-primary-700 dark:text-primary-300' : 'text-dim hover:text-ink'}`}>
            <Icon name="more-horizontal" size={21} />
            <span>更多</span>
          </button>
        </nav>
      )}

      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
      {menuOpen && (
        <Dialog title="更多功能" onClose={() => setMenuOpen(false)}>
          <nav aria-label="更多导航" className="grid gap-1.5">
            {secondaryItems.map((item) => {
              const active = itemActive(item, location.pathname)
              return (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined} className={`flex min-h-13 items-center gap-3 rounded-xl px-3.5 text-sm font-medium ${active ? 'bg-primary-50 text-primary-800 dark:bg-primary-950/35 dark:text-primary-200' : 'text-ink2 hover:bg-surface-2'}`}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2"><Icon name={item.icon} size={19} /></span>
                  <span className="flex-1">{item.label}</span><Icon name="chevron-right" size={16} className="text-dim" />
                </NavLink>
              )
            })}
          </nav>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
            <button onClick={() => { setMenuOpen(false); startTour() }} className="btn-outline px-3"><Icon name="target" size={16} />页面导览</button>
            <button onClick={() => { setMenuOpen(false); setShowFeedback(true) }} className="btn-outline px-3"><Icon name="megaphone" size={16} />问题反馈</button>
          </div>
          <Link to="/settings" onClick={() => setMenuOpen(false)} className="mt-4 flex items-center gap-3 rounded-xl bg-surface-2/60 p-3 text-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 font-serif font-bold text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">{user.username.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{user.username}</span><span className="text-xs text-dim">查看账号与设置</span></span>
            <Icon name="arrow-up-right" size={16} className="text-dim" />
          </Link>
        </Dialog>
      )}
    </div>
  )
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return <GuideProvider user={user}><Shell user={user}>{children}</Shell></GuideProvider>
}
