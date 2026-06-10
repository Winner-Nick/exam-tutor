import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import type { Feedback, Invite, User } from '../types'

const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 font-bold">{title}</h3>
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
    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
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
    onSuccess: ({ code }) => {
      navigator.clipboard?.writeText(code).catch(() => {})
      toast(`邀请码 ${code} 已生成并复制`)
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

  function copy(code: string) {
    navigator.clipboard?.writeText(code).then(
      () => toast('已复制'),
      () => toast('复制失败，请手动复制', 'error'),
    )
  }

  const selectCls =
    'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800'

  return (
    <Card title="邀请家人 / 同学">
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        生成邀请码发给对方，注册时填写。可随时撤销未用完的码。
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          可用次数
          <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className={selectCls}>
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>{n} 次</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          有效期
          <select
            value={ttlDays ?? 'forever'}
            onChange={(e) => setTtlDays(e.target.value === 'forever' ? null : Number(e.target.value))}
            className={selectCls}
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
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {create.isPending ? '生成中…' : '生成邀请码'}
        </button>
      </div>

      {invites.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : invites.isError ? (
        <p className="py-4 text-center text-sm text-slate-400">列表加载失败</p>
      ) : invites.data.invites.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">还没有邀请码</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {invites.data.invites.map((inv) => {
            const st = INVITE_STATUS[inv.status]
            return (
              <li key={inv.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <button
                  onClick={() => copy(inv.code)}
                  title="点击复制"
                  className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-sm hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                >
                  {inv.code}
                </button>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                  {st.label}
                </span>
                <span className="text-xs text-slate-400">
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
                    className="rounded-lg px-2 py-1 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30"
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span className="font-medium text-slate-600 dark:text-slate-300">{fb.username || '未知用户'}</span>
        <span>{new Date(fb.created_at * 1000).toLocaleString('zh-CN')}</span>
        {fb.page && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">{fb.page}</span>}
        {errors.length > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
            {errors.length} 条报错
          </span>
        )}
        <span className="flex-1" />
        <button onClick={() => setOpen(!open)} className="text-primary-600">
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
        <pre className="thin-scroll mt-2 max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
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
    <Card title="用户反馈">
      {q.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : q.isError ? (
        <p className="py-4 text-center text-sm text-slate-400">加载失败</p>
      ) : q.data.feedback.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">还没有收到反馈</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {q.data.feedback.map((fb) => (
            <FeedbackItem key={fb.id} fb={fb} onDelete={() => del.mutate(fb.id)} />
          ))}
        </ul>
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

  async function logout() {
    await api.logout()
    qc.clear()
    navigate('/login')
  }

  const changePw = useMutation({
    mutationFn: () => api.changePassword(oldPw, newPw),
    onSuccess: () => {
      toast('密码已修改')
      setOldPw('')
      setNewPw('')
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '修改失败', 'error'),
  })

  function submitPw(e: FormEvent) {
    e.preventDefault()
    if (newPw.length < 8) {
      toast('新密码至少 8 位', 'error')
      return
    }
    changePw.mutate()
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card title="账号">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-slate-500 dark:text-slate-400">
            {user.username}（{user.role === 'admin' ? '管理员' : '普通用户'}）
          </p>
          <button
            onClick={logout}
            className="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:border-rose-300 hover:text-rose-500 dark:border-slate-700"
          >
            退出登录
          </button>
        </div>
      </Card>

      <Card title="修改密码">
        <form onSubmit={submitPw} className="space-y-3">
          <input
            className={inputCls}
            type="password"
            placeholder="原密码"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            autoComplete="current-password"
          />
          <input
            className={inputCls}
            type="password"
            placeholder="新密码（至少 8 位）"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            autoComplete="new-password"
          />
          <button
            disabled={!oldPw || !newPw || changePw.isPending}
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            保存
          </button>
        </form>
      </Card>

      {user.role === 'admin' && <InviteManager />}
      {user.role === 'admin' && <FeedbackManager />}
    </div>
  )
}
