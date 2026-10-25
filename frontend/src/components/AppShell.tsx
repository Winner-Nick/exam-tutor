import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useUi } from '../store'
import type { User } from '../types'
import { Dialog } from './Dialog'
import { FeedbackDialog } from './FeedbackDialog'
import { GuideProvider, useGuide } from './GuideProvider'
import { Icon, type IconName } from './Icon'

const teacherNav: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: '批改', icon: 'pen', end: true },
  { to: '/papers', label: '试卷库', icon: 'book' },
  { to: '/students', label: '学生', icon: 'users' },
  { to: '/mistakes', label: '错题复习', icon: 'bookmark' },
  { to: '/stats', label: '统计', icon: 'chart' },
  { to: '/guide', label: '教程', icon: 'book-open' },
  { to: '/settings', label: '设置', icon: 'settings' },
]

const studentNav: typeof teacherNav = [
  { to: '/', label: '批改', icon: 'pen', end: true },
  { to: '/mistakes', label: '错题复习', icon: 'bookmark' },
  { to: '/stats', label: '统计', icon: 'chart' },
  { to: '/guide', label: '教程', icon: 'book-open' },
  { to: '/settings', label: '设置', icon: 'settings' },
]

function Shell({ user, children }: { user: User; children: ReactNode }) {
  const theme = useUi((state) => state.theme)
  const toggleTheme = useUi((state) => state.toggleTheme)
  const { startTour } = useGuide()
  const [showFeedback, setShowFeedback] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navItems = user.role === 'student' ? studentNav : teacherNav
  const current = location.pathname.startsWith('/jobs/')
    ? navItems[0]
    : navItems.find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-3 sm:px-5">
          <Link to="/" aria-label="错题家教首页" className="flex shrink-0 items-center gap-2 rounded-lg px-1">
            <span className="seal h-9 w-9 text-base">错</span>
            <span className="hidden font-serif text-lg font-bold text-ink lg:inline">错题家教</span>
          </Link>
          <span className="min-w-0 flex-1 truncate px-2 text-sm font-semibold md:hidden">{current?.label ?? '错题家教'}</span>
          <nav data-tour="main-nav" aria-label="主导航" className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium whitespace-nowrap transition-colors lg:px-3 ${
                    isActive ? 'bg-primary-600/10 text-primary-700 dark:text-primary-300' : 'text-ink2 hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="hidden max-w-28 shrink-0 truncate text-sm text-dim xl:inline" title={user.username}>{user.username}</span>
          <button onClick={() => setShowFeedback(true)} title="问题反馈" aria-label="问题反馈" className="icon-btn hidden sm:inline-flex">
            <Icon name="megaphone" size={19} />
          </button>
          <button onClick={toggleTheme} title="切换深浅主题" aria-label="切换深浅主题" className="icon-btn">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
          </button>
          <button onClick={() => setMenuOpen(true)} className="icon-btn md:hidden" aria-label="打开导航菜单" aria-expanded={menuOpen}>
            <Icon name="list" size={21} />
          </button>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:py-8 ${location.pathname.startsWith('/jobs/') ? 'max-w-7xl' : 'max-w-6xl'}`}>{children}</main>
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
      {menuOpen && (
        <Dialog title="导航与帮助" onClose={() => setMenuOpen(false)}>
          <nav aria-label="移动端导航" className="grid gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium ${isActive ? 'bg-primary-600/10 text-primary-700 dark:text-primary-300' : 'text-ink2 hover:bg-surface-2'}`}
              >
                <Icon name={item.icon} size={19} /> {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
            <button onClick={() => { setMenuOpen(false); startTour() }} className="btn-outline px-3"><Icon name="target" size={16} /> 页面导览</button>
            <button onClick={() => { setMenuOpen(false); setShowFeedback(true) }} className="btn-outline px-3"><Icon name="megaphone" size={16} /> 问题反馈</button>
          </div>
          <p className="mt-4 truncate text-sm text-dim">当前账号：{user.username}</p>
        </Dialog>
      )}
    </div>
  )
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return <GuideProvider user={user}><Shell user={user}>{children}</Shell></GuideProvider>
}
