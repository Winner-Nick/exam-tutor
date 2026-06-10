import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useUi } from '../store'
import type { User } from '../types'

const navItems = [
  { to: '/', label: '试卷', end: true },
  { to: '/mistakes', label: '错题本' },
  { to: '/stats', label: '统计' },
  { to: '/settings', label: '设置' },
]

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const { theme, toggleTheme } = useUi()
  const navigate = useNavigate()
  const qc = useQueryClient()

  async function logout() {
    await api.logout()
    qc.clear()
    navigate('/login')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:gap-4 sm:px-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 px-1 font-bold text-primary-600 dark:text-primary-400"
          >
            <span className="text-xl">📘</span>
            <span className="hidden md:inline">错题家教</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
            {navItems.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `rounded-lg px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${
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
          <button
            onClick={toggleTheme}
            title="切换深浅主题"
            className="shrink-0 rounded-lg p-1.5 text-lg hover:bg-slate-100 sm:p-2 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
            <span className="hidden text-slate-500 md:inline dark:text-slate-400">{user.username}</span>
            <button
              onClick={logout}
              title={`退出（${user.username}）`}
              className="rounded-lg px-1.5 py-1.5 text-slate-500 whitespace-nowrap hover:bg-slate-100 hover:text-slate-700 sm:px-2 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              退出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
