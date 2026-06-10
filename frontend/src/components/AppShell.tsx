import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useUi } from '../store'
import type { User } from '../types'

const navItems = [
  { to: '/', label: '批改', end: true },
  { to: '/papers', label: '试卷库' },
  { to: '/students', label: '学生' },
  { to: '/mistakes', label: '错题本' },
  { to: '/stats', label: '统计' },
  { to: '/settings', label: '设置' },
]

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const { theme, toggleTheme } = useUi()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:gap-3 sm:px-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 px-1 font-bold text-primary-600 dark:text-primary-400"
          >
            <span className="text-xl">📘</span>
            <span className="hidden md:inline">错题家教</span>
          </Link>
          {/* 窄屏放不下时横向滑动，避免与右侧按钮重叠 */}
          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
            {navItems.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`
                }
              >
                {it.label}
              </NavLink>
            ))}
          </nav>
          <span
            className="hidden max-w-28 shrink-0 truncate text-sm text-slate-500 lg:inline dark:text-slate-400"
            title={user.username}
          >
            {user.username}
          </span>
          <button
            onClick={toggleTheme}
            title="切换深浅主题"
            className="shrink-0 rounded-lg p-1.5 text-lg hover:bg-slate-100 sm:p-2 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
