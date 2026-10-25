import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Dialog } from '../components/Dialog'
import { Icon, type IconName } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import type { AdminUser, Feedback, Invite, User } from '../types'
import { copyText } from '../utils/clipboard'

function Card({
  title,
  icon,
  children,
}: {
  title: string
  icon: IconName
  children: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <h3 className="section-title mb-3 flex items-center gap-2 text-base">
        <Icon name={icon} size={17} className="text-primary-600 dark:text-primary-400" />
        {title}
      </h3>
      {children}
    </div>
  )
}

const INVITE_STATUS: Record<Invite['status'], { label: string; cls: string }> = {
  active: {
    label: '可用',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  used_up: {
    label: '已用完',
    cls: 'bg-surface-2 text-dim',
  },
  expired: {
    label: '已过期',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
}

function InviteManager() {
  const toast = useToast()
  const qc = useQueryClient()
  const [maxUses, setMaxUses] = useState(1)
  const [ttlDays, setTtlDays] = useState<number | null>(30)

  const invites = useQuery({ queryKey: ['invites'], queryFn: api.listInvites })

  const create = useMutation({
    mutationFn: () => api.createInvite(maxUses, ttlDays),
    onSuccess: async ({ code }) => {
      const copied = await copyText(code)
      toast(copied ? `邀请码 ${code} 已生成并复制` : `邀请码 ${code} 已生成，请从下方手动复制`, copied ? 'info' : 'error')
      qc.invalidateQueries({ queryKey: ['invites'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '生成失败', 'error'),
  })

  const revoke = useMutation({
    mutationFn: api.revokeInvite,
    onSuccess: () => {
      toast('已撤销')
      qc.invalidateQueries({ queryKey: ['invites'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '撤销失败', 'error'),
  })

  async function copy(code: string) {
    const copied = await copyText(code)
    toast(copied ? '已复制' : '复制失败，请选中邀请码手动复制', copied ? 'info' : 'error')
  }

  return (
    <Card title="邀请家人 / 同学" icon="users">
      <p className="mb-3 text-sm text-ink2">
        生成邀请码发给对方，注册时填写。可随时撤销未用完的码。
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-ink2">
          可用次数
          <select
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            className="input w-auto px-2 py-1.5"
          >
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>{n} 次</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink2">
          有效期
          <select
            value={ttlDays ?? 'forever'}
            onChange={(e) => setTtlDays(e.target.value === 'forever' ? null : Number(e.target.value))}
            className="input w-auto px-2 py-1.5"
          >
            <option value={1}>1 天</option>
            <option value={7}>7 天</option>
            <option value={30}>30 天</option>
            <option value="forever">永久</option>
          </select>
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="btn-primary px-4 py-2 text-sm"
        >
          {create.isPending ? '生成中…' : '生成邀请码'}
        </button>
      </div>

      {invites.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : invites.isError ? (
        <p className="py-4 text-center text-sm text-dim">列表加载失败</p>
      ) : invites.data.invites.length === 0 ? (
        <p className="py-4 text-center text-sm text-dim">还没有邀请码</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {invites.data.invites.map((inv) => {
            const st = INVITE_STATUS[inv.status]
            return (
              <li key={inv.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <button
                  onClick={() => copy(inv.code)}
                  title="点击复制"
                  className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-sm transition-colors hover:bg-line"
                >
                  {inv.code}
                </button>
                <span className={`badge ${st.cls}`}>{st.label}</span>
                <span className="text-xs text-dim">
                  已用 {inv.used_count}/{inv.max_uses}
                  {' · '}
                  {inv.expires_at
                    ? `${new Date(inv.expires_at * 1000).toLocaleDateString('zh-CN')} 到期`
                    : '永久有效'}
                </span>
                <span className="flex-1" />
                {inv.status === 'active' && (
                  <button
                    onClick={() => {
                      if (confirm(`撤销邀请码 ${inv.code}？撤销后无法再用于注册。`)) {
                        revoke.mutate(inv.code)
                      }
                    }}
                    className="rounded-lg px-2 py-1 text-xs text-rose-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-900/30"
                  >
                    撤销
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function FeedbackItem({ fb, onDelete }: { fb: Feedback; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const d = fb.diag
  const errors = d.errors ?? []
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
        <span className="font-medium text-ink2">{fb.username || '未知用户'}</span>
        <span>{new Date(fb.created_at * 1000).toLocaleString('zh-CN')}</span>
        {fb.page && <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{fb.page}</span>}
        {errors.length > 0 && (
          <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
            {errors.length} 条报错
          </span>
        )}
        <span className="flex-1" />
        <button onClick={() => setOpen(!open)} className="text-primary-600 dark:text-primary-400">
          {open ? '收起' : '设备详情'}
        </button>
        <button
          onClick={() => {
            if (confirm('删除这条反馈？')) onDelete()
          }}
          className="text-rose-400 hover:text-rose-600"
        >
          删除
        </button>
      </div>
      {fb.message && <p className="mt-1.5 text-sm whitespace-pre-wrap">{fb.message}</p>}
      {open && (
        <pre className="thin-scroll mt-2 max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink2">
          {JSON.stringify(d, null, 2)}
        </pre>
      )}
    </li>
  )
}

function FeedbackManager() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin-feedback'], queryFn: api.listFeedback })

  const del = useMutation({
    mutationFn: api.deleteFeedback,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-feedback'] }),
    onError: (e) => toast(e instanceof ApiError ? e.message : '删除失败', 'error'),
  })

  return (
    <Card title="用户反馈" icon="megaphone">
      {q.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : q.isError ? (
        <p className="py-4 text-center text-sm text-dim">加载失败</p>
      ) : q.data.feedback.length === 0 ? (
        <p className="py-4 text-center text-sm text-dim">还没有收到反馈</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {q.data.feedback.map((fb) => (
            <FeedbackItem key={fb.id} fb={fb} onDelete={() => del.mutate(fb.id)} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function AdminUserManager() {
  const toast = useToast()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.listAdminUsers })
  const [target, setTarget] = useState<AdminUser | null>(null)
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => api.resetAdminUserPassword(id, value),
    onSuccess: () => {
      toast('密码已重置，旧登录会话已失效')
      setTarget(null)
      setPassword('')
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '重置失败', 'error'),
  })
  return (
    <Card title="账号与密码恢复" icon="users">
      <p className="mb-3 text-sm text-ink2">管理员可重置老师、学生或其他管理员密码；重置后旧设备需要重新登录。</p>
      {users.isPending ? <Spinner /> : users.isError ? <p className="text-sm text-rose-700">账号列表加载失败，请稍后重试。</p> : (
        <ul className="divide-y divide-line/60">
          {(users.data?.users ?? []).map((item) => (
            <li key={item.id} className="flex min-h-12 flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{item.username}<span className="ml-2 text-xs font-normal text-dim">{item.role}{item.student_name ? ` · ${item.student_name}` : ''}</span></span>
              <button onClick={() => setTarget(item)} className="btn-outline px-3 py-1.5 text-xs">重置密码</button>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <Dialog title={`重置 ${target.username} 的密码`} onClose={() => !reset.isPending && setTarget(null)}>
          <form onSubmit={(event) => { event.preventDefault(); if (password.length >= 8) reset.mutate({ id: target.id, value: password }) }} className="space-y-3">
            <p className="text-sm text-ink2">新密码只用于本次交付，对方登录后应立即修改。旧会话会全部失效。</p>
            <input aria-label="新密码" type="password" minLength={8} maxLength={128} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="input" placeholder="新密码（至少 8 位）" />
            <button disabled={password.length < 8 || reset.isPending} className="btn-primary w-full px-4 py-2">{reset.isPending ? '正在重置…' : '确认重置'}</button>
          </form>
        </Dialog>
      )}
    </Card>
  )
}

export function SettingsPage() {
  const user = useOutletContext<User>()
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { qc.clear(); navigate('/login') },
    onError: (error) => toast(error instanceof ApiError ? error.message : '退出失败，请检查网络后重试', 'error'),
  })
  const changePw = useMutation({
    mutationFn: () => api.changePassword(oldPw, newPw),
    onSuccess: () => {
      toast('密码已修改，其他设备已退出登录')
      setOldPw('')
      setNewPw('')
      setConfirmPw('')
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '修改失败', 'error'),
  })

  function submitPw(event: FormEvent) {
    event.preventDefault()
    if (newPw.length < 8) return toast('新密码至少 8 位', 'error')
    if (newPw !== confirmPw) return toast('两次输入的新密码不一致', 'error')
    changePw.mutate()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="设置" description="管理账号、邀请、密码恢复与用户反馈。" helpAnchor="account" />
      <Card title="账号" icon="user">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-ink2">{user.username}<span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-dim">{user.role === 'admin' ? '管理员' : user.role === 'student' ? '学生' : '老师'}</span></p>
          <button disabled={logout.isPending} onClick={() => logout.mutate()} className="btn-danger shrink-0 px-3 py-1.5 text-sm"><Icon name="logout" size={14} />{logout.isPending ? '正在退出…' : '退出登录'}</button>
        </div>
      </Card>
      <Card title="修改密码" icon="settings">
        <form onSubmit={submitPw} className="space-y-3">
          <input aria-label="原密码" className="input" type="password" placeholder="原密码" required maxLength={128} value={oldPw} onChange={(event) => setOldPw(event.target.value)} autoComplete="current-password" />
          <input aria-label="新密码" className="input" type="password" placeholder="新密码（至少 8 位）" required minLength={8} maxLength={128} value={newPw} onChange={(event) => setNewPw(event.target.value)} autoComplete="new-password" />
          <input aria-label="再次输入新密码" className="input" type="password" placeholder="再次输入新密码" required minLength={8} maxLength={128} value={confirmPw} onChange={(event) => setConfirmPw(event.target.value)} autoComplete="new-password" />
          <button disabled={!oldPw || !newPw || !confirmPw || changePw.isPending} className="btn-primary px-4 py-2 text-sm">{changePw.isPending ? '正在保存…' : '保存新密码'}</button>
        </form>
      </Card>
      {user.role === 'admin' && <AdminUserManager />}
      {user.role === 'admin' && <InviteManager />}
      {user.role === 'admin' && <FeedbackManager />}
    </div>
  )
}
