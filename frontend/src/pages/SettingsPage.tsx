import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useToast } from '../components/Toast'
import type { User } from '../types'

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

export function SettingsPage() {
  const user = useOutletContext<User>()
  const toast = useToast()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  const changePw = useMutation({
    mutationFn: () => api.changePassword(oldPw, newPw),
    onSuccess: () => {
      toast('密码已修改')
      setOldPw('')
      setNewPw('')
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '修改失败', 'error'),
  })

  const invite = useMutation({
    mutationFn: api.createInvite,
    onSuccess: ({ code }) => {
      setInviteCode(code)
      navigator.clipboard?.writeText(code).catch(() => {})
      toast('邀请码已生成并复制')
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '生成失败', 'error'),
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
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {user.username}（{user.role === 'admin' ? '管理员' : '普通用户'}）
        </p>
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

      {user.role === 'admin' && (
        <Card title="邀请家人 / 同学">
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            生成一次性邀请码，对方注册时填写即可。
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => invite.mutate()}
              disabled={invite.isPending}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              生成邀请码
            </button>
            {inviteCode && (
              <code className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-sm dark:bg-slate-800">
                {inviteCode}
              </code>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
