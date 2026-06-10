import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Spinner } from '../components/Spinner'
import { useUi } from '../store'

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { theme, toggleTheme } = useUi()

  const m = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.login(username.trim(), password)
        : api.register(username.trim(), password, invite.trim() || null),
    onSuccess: (user) => {
      qc.setQueryData(['me'], user)
      navigate('/')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : '网络异常，请重试'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) return
    m.mutate()
  }

  const inputCls =
    'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900'

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <button onClick={toggleTheme} className="absolute top-4 right-4 rounded-lg p-2 text-lg">
        {theme === 'dark' ? '🌙' : '☀️'}
      </button>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl">📘</div>
          <h1 className="mt-2 text-2xl font-bold">错题家教</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            上传试卷，自动判分，AI 讲解每一道错题
          </p>
        </div>
        <form
          onSubmit={submit}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium dark:bg-slate-800">
            {(['login', 'register'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setMode(k)
                  setError('')
                }}
                className={`rounded-lg py-1.5 transition-colors ${
                  mode === k
                    ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-300'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {k === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>
          <input
            className={inputCls}
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            className={inputCls}
            type="password"
            placeholder={mode === 'register' ? '密码（至少 8 位）' : '密码'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <input
              className={inputCls}
              placeholder="邀请码"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
          )}
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={m.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
          >
            {m.isPending && <Spinner className="h-4 w-4 text-white" />}
            {mode === 'login' ? '登录' : '创建账号'}
          </button>
          {mode === 'register' && (
            <p className="text-center text-xs text-slate-400">没有邀请码？向管理员索取</p>
          )}
        </form>
      </div>
    </div>
  )
}
