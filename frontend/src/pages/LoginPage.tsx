import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Icon, type IconName } from '../components/Icon'
import { Spinner } from '../components/Spinner'
import { useUi } from '../store'

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'camera', title: '拍照即可批改', desc: '试卷只录入一次，多份作答轻松复用。' },
  { icon: 'check-circle', title: '判分清楚可核对', desc: '答案、识别与人工确认，每一步都有依据。' },
  { icon: 'bookmark', title: '错题真正会复习', desc: '逐题讲解配合间隔复习，而不是只看分数。' },
]

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <div className="login-page relative min-h-dvh overflow-hidden bg-surface lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(28rem,0.92fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-paper lg:flex lg:flex-col lg:px-12 xl:px-20" aria-label="产品特色">
        <div className="pointer-events-none absolute -top-32 -right-24 h-96 w-96 rounded-full border-[70px] border-primary-100/50 dark:border-primary-950/30" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[30rem] w-[30rem] rounded-full bg-primary-100/40 blur-3xl dark:bg-primary-950/30" />
        <div className="relative flex h-28 items-center gap-3">
          <span className="seal h-11 w-11 text-xl">错</span>
          <div><p className="font-serif text-xl font-bold">错题家教</p><p className="mt-0.5 text-[9px] font-semibold tracking-[0.22em] text-dim">EXAM TUTOR</p></div>
        </div>
        <div className="relative my-auto max-w-xl py-12">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-primary-700 dark:text-primary-300"><span className="h-px w-8 bg-primary-400" />从一道错题开始</p>
          <h2 className="mt-6 font-serif text-[2.65rem] leading-[1.35] font-bold tracking-normal xl:text-5xl xl:leading-[1.35]">让每一道错题，<br />都成为进步的下一步。</h2>
          <p className="mt-6 max-w-md text-base leading-8 text-ink2">拍照、核对、讲解、复习。把繁琐的批改交给工具，把时间和注意力留给真正重要的学习。</p>
          <div className="mt-10 space-y-3">
            {FEATURES.map((feature, index) => (
              <div key={feature.title} className="flex items-center gap-4 rounded-2xl border border-line/70 bg-surface/75 p-4 shadow-sm backdrop-blur-sm">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"><Icon name={feature.icon} size={21} /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{feature.title}</p><p className="mt-1 text-xs leading-5 text-dim">{feature.desc}</p></div>
                <span className="font-serif text-xs text-dim">0{index + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative pb-8 text-xs tracking-wide text-dim">为老师、家长和每一位认真学习的人而设计</p>
      </aside>

      <main className="relative flex min-h-dvh items-center justify-center px-4 py-16 sm:px-8 lg:min-h-full lg:px-10">
        <div className="pointer-events-none absolute top-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-primary-100/40 blur-3xl lg:hidden dark:bg-primary-950/25" />
        <button onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} className="icon-btn absolute top-4 right-4 z-10 sm:top-6 sm:right-6" aria-label="切换深浅主题">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
        </button>

        <div className="relative w-full max-w-[25rem]">
          <div className="mb-7 text-center lg:hidden">
            <div className="seal mx-auto h-13 w-13 text-2xl">错</div>
            <p className="mt-3 font-serif text-2xl font-bold">错题家教</p>
            <p className="mt-1 text-xs text-dim">让每一道错题都有收获</p>
          </div>

          <div className="card p-5 sm:p-7 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-primary-700 dark:text-primary-300">{mode === 'login' ? 'WELCOME BACK' : 'JOIN EXAM TUTOR'}</p>
              <h1 className="mt-2 font-serif text-3xl font-bold">{mode === 'login' ? '欢迎回来' : '创建你的账号'}</h1>
              <p className="mt-2 text-sm leading-6 text-ink2">{mode === 'login' ? '登录后继续今天的批改与复习。' : bootstrap ? '首位注册账号将成为管理员。' : '几步即可开始更清晰的学习管理。'}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-sm font-medium" role="group" aria-label="登录或注册">
              {(['login', 'register'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  onClick={() => {
                    setMode(key)
                    setError('')
                  }}
                  className={`min-h-10 rounded-[0.65rem] transition-all ${mode === key ? 'bg-surface text-ink shadow-sm' : 'text-dim hover:text-ink'}`}
                >
                  {key === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              {state?.reason === 'expired' && mode === 'login' && (
                <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                  <Icon name="clock" size={17} className="mt-1 shrink-0" /><p>会话已过期或密码已重置。请重新登录，成功后会返回刚才的页面。</p>
                </div>
              )}
              {mode === 'register' && bootstrap && (
                <div className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm leading-6 text-primary-800 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-200">
                  <p className="font-semibold">欢迎使用，创建首位管理员</p>
                  <p className="mt-1">当前还没有账号。首个账号无需邀请码，请妥善保存密码。</p>
                </div>
              )}

              <label className="block text-sm font-medium text-ink2">
                用户名
                <input
                  className="input mt-1.5"
                  value={username}
                  onChange={(event) => { setUsername(event.target.value); setError('') }}
                  autoComplete="username"
                  placeholder="输入用户名"
                  required
                  maxLength={32}
                />
              </label>
              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-ink2">密码</label>
                <div className="relative mt-1.5">
                  <input
                    id="login-password"
                    className="input pr-12"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={mode === 'register' ? '至少 8 位，可使用中文' : '输入密码'}
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setError('') }}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={mode === 'register' ? 8 : undefined}
                    maxLength={128}
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} className="icon-btn absolute top-1/2 right-1 -translate-y-1/2">
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                  </button>
                </div>
              </div>
              {mode === 'register' && needsInvite && (
                <label className="block text-sm font-medium text-ink2">
                  邀请码
                  <input className="input mt-1.5" placeholder="向管理员索取邀请码" value={invite} onChange={(event) => { setInvite(event.target.value); setError('') }} required />
                </label>
              )}
              {mode === 'register' && !needsInvite && !bootstrap && (
                <p className="rounded-xl bg-surface-2/70 p-3 text-sm text-ink2">当前开放注册，无需邀请码。</p>
              )}
              {mode === 'register' && options.isError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
                  <p>注册配置加载失败。当前按邀请码注册处理，请填写邀请码，或重试加载配置。</p>
                  <button type="button" disabled={options.isFetching} onClick={() => void options.refetch()} className="mt-2 min-h-8 font-semibold underline underline-offset-4">
                    {options.isFetching ? '正在重试…' : '重试加载注册配置'}
                  </button>
                </div>
              )}
              {error && (
                <p className="fade-up flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm leading-6 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
                  <Icon name="alert" size={16} className="mt-1 shrink-0" /> {error}
                </p>
              )}
              <button
                type="submit"
                disabled={mutation.isPending || (mode === 'register' && needsInvite && !invite.trim())}
                className="btn-primary min-h-12 w-full px-4 text-base"
              >
                {mutation.isPending ? <><Spinner className="h-4 w-4" />{mode === 'login' ? '正在登录…' : '正在创建…'}</> : <>{mode === 'login' ? '登录' : bootstrap ? '创建首位管理员' : '创建账号'}<Icon name="arrow-right" size={17} /></>}
              </button>

              {mode === 'login' ? (
                <details className="rounded-xl text-sm text-ink2">
                  <summary className="flex min-h-10 cursor-pointer items-center justify-center font-medium text-dim hover:text-ink">忘记密码？</summary>
                  <p className="rounded-xl bg-surface-2/70 p-3 leading-6">学生请联系老师重置密码；老师请联系管理员。管理员无法登录时，需要由服务器管理人员在本机运行密码重置脚本。</p>
                </details>
              ) : (
                needsInvite && <p className="text-center text-xs text-dim">没有邀请码？请向管理员索取</p>
              )}
            </form>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-dim"><Icon name="check-circle" size={14} />识别结果可核对，学习记录按学生独立保存</p>
        </div>
      </main>
    </div>
  )
}
