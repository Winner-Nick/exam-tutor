import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Icon } from '../components/Icon'
import { Spinner } from '../components/Spinner'
import { useUi } from '../store'

const FEATURES: { icon: Parameters<typeof Icon>[0]['name']; title: string; desc: string }[] = [
  { icon: 'camera', title: '拍照批改', desc: '手机拍照上传，秒出判分' },
  { icon: 'sparkles', title: 'AI 讲解', desc: '每道错题都有考点与解析' },
  { icon: 'bookmark', title: '错题本', desc: '按知识点自动归集，温故知新' },
]

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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* 背景装饰：淡淡的书卷光晕 */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-primary-200/30 blur-3xl dark:bg-primary-900/20" />
      <button onClick={toggleTheme} className="icon-btn absolute top-4 right-4" title="切换主题">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
      </button>

      <div className="relative w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="seal mx-auto h-16 w-16 rounded-2xl text-3xl shadow-xl">错</div>
          <h1 className="mt-4 font-serif text-3xl font-bold tracking-wide">错题家教</h1>
          <p className="mt-2 text-sm text-dim">拍照上传作答，自动判分，AI 讲解每一道错题</p>
        </div>

        <form onSubmit={submit} className="card space-y-3 p-6">
          <div className="mb-4 grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-sm font-medium">
            {(['login', 'register'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setMode(k)
                  setError('')
                }}
                className={`rounded-lg py-1.5 transition-all ${
                  mode === k ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300' : 'text-dim'
                }`}
              >
                {k === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            className="input"
            type="password"
            placeholder={mode === 'register' ? '密码（至少 8 位）' : '密码'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <input
              className="input"
              placeholder="邀请码"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
          )}
          {error && (
            <p className="fade-up flex items-center gap-1.5 text-sm text-rose-600 dark:text-rose-400">
              <Icon name="alert" size={15} /> {error}
            </p>
          )}
          <button
            type="submit"
            disabled={m.isPending}
            className="btn-primary w-full py-2.5 text-sm font-semibold"
          >
            {m.isPending && <Spinner className="h-4 w-4 text-white" />}
            {mode === 'login' ? '登 录' : '创建账号'}
          </button>
          {mode === 'register' && (
            <p className="text-center text-xs text-dim">没有邀请码？向管理员索取</p>
          )}
        </form>

        <div className="mt-6 grid grid-cols-3 gap-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface/70 p-3 text-center">
              <Icon name={f.icon} size={20} className="mx-auto text-primary-600 dark:text-primary-400" />
              <p className="mt-1.5 text-xs font-semibold">{f.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-dim">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
