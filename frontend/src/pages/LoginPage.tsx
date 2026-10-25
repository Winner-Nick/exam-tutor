import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Icon } from '../components/Icon'
import { Spinner } from '../components/Spinner'
import { useUi } from '../store'

const FEATURES: { icon: Parameters<typeof Icon>[0]['name']; title: string; desc: string }[] = [
  { icon: 'camera', title: '拍照批改', desc: '手机拍照上传，清晰判分' },
  { icon: 'sparkles', title: 'AI 讲解', desc: '逐题核对答案与解析' },
  { icon: 'bookmark', title: '错题复习', desc: '按到期时间温故知新' },
]

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const theme = useUi((state) => state.theme)
  const toggleTheme = useUi((state) => state.toggleTheme)
  const options = useQuery({ queryKey: ['registration-options'], queryFn: api.registrationOptions, retry: 1 })
  const state = location.state as { from?: string; reason?: string } | null
  const bootstrap = options.data?.bootstrap ?? false
  const openRegister = options.data?.allow_open_register ?? false
  const needsInvite = !bootstrap && !openRegister

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.login(username.trim(), password)
        : api.register(username.trim(), password, needsInvite ? invite.trim() || null : null),
    onSuccess: (user) => {
      qc.clear()
      qc.setQueryData(['me'], user)
      const target = state?.from?.startsWith('/') && !state.from.startsWith('//') ? state.from : '/'
      navigate(target, { replace: true })
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '网络异常，请检查连接后重试'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!username.trim() || !password || (mode === 'register' && needsInvite && !invite.trim())) return
    mutation.mutate()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-primary-200/30 blur-3xl dark:bg-primary-900/20" />
      <button onClick={toggleTheme} className="icon-btn absolute top-4 right-4" aria-label="切换深浅主题">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
      </button>

      <main className="relative w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="seal mx-auto h-16 w-16 rounded-2xl text-3xl shadow-xl">错</div>
          <h1 className="mt-4 font-serif text-3xl font-bold tracking-wide">错题家教</h1>
          <p className="mt-2 text-sm text-ink2">拍照上传作答，核对判分，逐题讲解与复习</p>
        </div>

        <form onSubmit={submit} className="card space-y-3 p-6">
          <div className="mb-4 grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-sm font-medium" role="group" aria-label="登录或注册">
            {(['login', 'register'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => {
                  setMode(key)
                  setError('')
                }}
                className={`min-h-11 rounded-lg transition-all ${mode === key ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300' : 'text-ink2'}`}
              >
                {key === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          {state?.reason === 'expired' && mode === 'login' && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200" role="status">
              会话已过期或账号已在其他设备重置密码。请重新登录，成功后会返回刚才的页面。
            </p>
          )}
          {mode === 'register' && bootstrap && (
            <div className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm leading-relaxed text-primary-800 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-200">
              <p className="font-semibold">欢迎使用，创建首位管理员</p>
              <p className="mt-1">当前还没有账号。首个账号将成为管理员，无需邀请码；请妥善保存密码。</p>
            </div>
          )}

          <label className="block text-sm font-medium text-ink2">
            用户名
            <input
              className="input mt-1"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              maxLength={32}
            />
          </label>
          <label className="block text-sm font-medium text-ink2">
            密码
            <input
              className="input mt-1"
              type="password"
              placeholder={mode === 'register' ? '至少 8 位，可使用中文' : ''}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : undefined}
              maxLength={128}
            />
          </label>
          {mode === 'register' && needsInvite && (
            <label className="block text-sm font-medium text-ink2">
              邀请码
              <input className="input mt-1" value={invite} onChange={(event) => setInvite(event.target.value)} required />
            </label>
          )}
          {mode === 'register' && !needsInvite && !bootstrap && (
            <p className="text-sm text-ink2">当前开放注册，无需邀请码。</p>
          )}
          {mode === 'register' && options.isError && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200" role="alert">
              <p>注册配置加载失败。当前按邀请码注册处理，请填写邀请码，或重试加载配置。</p>
              <button type="button" disabled={options.isFetching} onClick={() => void options.refetch()} className="mt-2 min-h-8 font-medium underline">
                {options.isFetching ? '正在重试…' : '重试加载注册配置'}
              </button>
            </div>
          )}
          {error && (
            <p className="fade-up flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300" role="alert">
              <Icon name="alert" size={15} /> {error}
            </p>
          )}
          <button
            type="submit"
            disabled={mutation.isPending || (mode === 'register' && needsInvite && !invite.trim())}
            className="btn-primary w-full px-4 font-semibold"
          >
            {mutation.isPending && <Spinner className="h-4 w-4 text-white" />}
            {mode === 'login' ? '登录' : bootstrap ? '创建首位管理员' : '创建账号'}
          </button>

          {mode === 'login' ? (
            <details className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink2">
              <summary className="min-h-8 cursor-pointer py-1 font-medium">忘记密码？</summary>
              <p className="pb-2 leading-relaxed">学生请联系老师重置登录密码；老师请联系管理员。管理员若无法登录，需要由服务器管理人员在本机运行管理员密码重置脚本。重置后旧设备会话会失效。</p>
            </details>
          ) : (
            needsInvite && <p className="text-center text-xs text-dim">没有邀请码？请向管理员索取</p>
          )}
        </form>

        <div className="mt-6 grid grid-cols-3 gap-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-line bg-surface/70 p-3 text-center">
              <Icon name={feature.icon} size={20} className="mx-auto text-primary-600 dark:text-primary-400" />
              <p className="mt-1.5 text-xs font-semibold">{feature.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink2">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
