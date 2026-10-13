import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useUi } from '../store'
import type { User } from '../types'
import { FeedbackDialog } from './FeedbackDialog'
import { Icon, type IconName } from './Icon'

const navItems: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: '批改', icon: 'pen', end: true },
  { to: '/papers', label: '试卷库', icon: 'book' },
  { to: '/students', label: '学生', icon: 'users' },
  { to: '/mistakes', label: '错题本', icon: 'bookmark' },
  { to: '/stats', label: '统计', icon: 'chart' },
  { to: '/settings', label: '设置', icon: 'settings' },
]

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const { theme, toggleTheme } = useUi()
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:gap-3 sm:px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 px-1">
            <span className="seal h-8 w-8 text-base">错</span>
            <span className="hidden font-serif text-lg font-bold text-ink md:inline">错题家教</span>
          </Link>
          {/* 窄屏放不下时横向滑动，避免与右侧按钮重叠 */}
          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
            {navItems.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${
                    isActive
                      ? 'bg-primary-600/10 text-primary-700 dark:text-primary-300'
                      : 'text-ink2 hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                <Icon name={it.icon} size={16} />
                {it.label}
              </NavLink>
            ))}
          </nav>
          <span
            className="hidden max-w-28 shrink-0 truncate text-sm text-dim lg:inline"
            title={user.username}
          >
            {user.username}
          </span>
          <button onClick={() => setShowFeedback(true)} title="问题反馈" className="icon-btn">
            <Icon name="megaphone" size={19} />
          </button>
          <button onClick={toggleTheme} title="切换深浅主题" className="icon-btn">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
    </div>
  )
}
