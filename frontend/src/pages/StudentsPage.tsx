import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import type { Student } from '../types'
import { invalidateStudentLearningData } from '../utils/query'

/** 学生登录账号的创建/重置/注销（内联在学生卡片里）。 */
function AccountPanel({ student, onClose }: { student: Student; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const done = (msg: string) => {
    toast(msg)
    qc.invalidateQueries({ queryKey: ['students'] })
    onClose()
  }
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : '操作失败', 'error')

  const create = useMutation({
    mutationFn: () => api.createStudentAccount(student.id, username.trim(), password),
    onSuccess: (r) => done(`账号已开通：${r.username}`),
    onError: fail,
  })
  const reset = useMutation({
    mutationFn: () => api.resetStudentAccountPassword(student.id, password),
    onSuccess: () => done('密码已重置'),
    onError: fail,
  })
  const revoke = useMutation({
    mutationFn: () => api.deleteStudentAccount(student.id),
    onSuccess: () => done('账号已注销'),
    onError: fail,
  })

  const hasAccount = !!student.account_username
  const busy = create.isPending || reset.isPending || revoke.isPending

  return (
    <form
      className="mt-3 space-y-2 rounded-xl bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (busy) return
        if (hasAccount) {
          if (password.length >= 8) reset.mutate()
        } else if (username.trim() && password.length >= 8) {
          create.mutate()
        }
      }}
    >
      {hasAccount ? (
        <p className="text-sm">
          登录账号：<span className="font-mono font-semibold">{student.account_username}</span>
          <span className="ml-2 text-xs text-dim">输入新密码即可重置</span>
        </p>
      ) : (
        <label className="block text-xs font-medium text-ink2">
          登录用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="登录用户名（2-32 位）"
            maxLength={32}
            autoComplete="off"
            className="input mt-1 bg-surface"
          />
        </label>
      )}
      <label className="block text-xs font-medium text-ink2">
        {hasAccount ? '新密码' : '初始密码'}
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder={hasAccount ? '新密码（至少 8 位）' : '初始密码（至少 8 位）'}
          maxLength={128}
          autoComplete="new-password"
          className="input mt-1 bg-surface"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || (hasAccount ? password.length < 8 : !username.trim() || password.length < 8)}
          className="btn-primary px-3.5 py-1.5 text-xs"
        >
          {hasAccount ? '重置密码' : '开通账号'}
        </button>
        {hasAccount && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm(`注销「${student.name}」的登录账号？其批改数据保留，但无法再登录。`))
                revoke.mutate()
            }}
            className="btn-danger px-3.5 py-1.5 text-xs"
          >
            注销账号
          </button>
        )}
        <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">
          取消
        </button>
      </div>
    </form>
  )
}

function StudentRow({ student }: { student: Student }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(student.name)
  const [showAccount, setShowAccount] = useState(false)

  const rename = useMutation({
    mutationFn: () => api.renameStudent(student.id, name.trim()),
    onSuccess: () => {
      setEditing(false)
      void invalidateStudentLearningData(qc)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '修改失败', 'error'),
  })
  const del = useMutation({
    mutationFn: () => api.deleteStudent(student.id),
    onSuccess: () => {
      toast('已删除')
      qc.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '删除失败', 'error'),
  })

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 font-serif text-lg font-bold text-primary-700 dark:bg-primary-950/35 dark:text-primary-300">
          {student.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          {editing ? (
            <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate() }}>
              <input aria-label={`${student.name}的新姓名`} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={32} className="input min-w-0 flex-1 px-2.5" />
              <button type="submit" disabled={rename.isPending || !name.trim()} className="btn-ghost px-2 text-primary-700 dark:text-primary-300">保存</button>
              <button type="button" onClick={() => { setName(student.name); setEditing(false) }} className="btn-ghost px-2">取消</button>
            </form>
          ) : (
            <>
              <p className="truncate text-base font-semibold">{student.name}</p>
              {student.account_username && <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-xs text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300"><Icon name="check-circle" size={11} /><span className="truncate">@{student.account_username}</span></span>}
              <p className="mt-1.5 text-xs text-dim">{student.submission_count} 次批改{(student.wrong_total ?? 0) > 0 && ` · 累计错题 ${student.wrong_total}`}</p>
            </>
          )}
        </div>
        {!editing && <div className="flex shrink-0 items-center gap-0.5">
          {!student.is_self && <button onClick={() => setShowAccount((v) => !v)} title="登录账号管理" aria-label={`${student.name}：登录账号管理`} aria-expanded={showAccount} className={`icon-btn ${showAccount ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/35 dark:text-primary-300' : ''}`}><Icon name="settings" size={17} /></button>}
          <button onClick={() => { setName(student.name); setEditing(true) }} title="改名" aria-label={`${student.name}：改名`} className="icon-btn"><Icon name="edit" size={17} /></button>
          {!student.is_self && <button disabled={del.isPending} onClick={() => { if (confirm(`确定删除学生「${student.name}」吗？其登录账号（如有）会一并注销。`)) del.mutate() }} title="删除" aria-label={`${student.name}：删除`} className="icon-btn hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/35"><Icon name="trash" size={17} /></button>}
        </div>}
      </div>
      {showAccount && !student.is_self && <AccountPanel student={student} onClose={() => setShowAccount(false)} />}
      <Link to={`/?student=${student.id}`} className="btn-outline mt-4 w-full px-4 text-primary-700 dark:text-primary-300">去批改<Icon name="arrow-right" size={16} /></Link>
    </div>
  )
}

export function StudentsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')

  const students = useQuery({ queryKey: ['students'], queryFn: api.listStudents })
  const create = useMutation({
    mutationFn: (n: string) => api.createStudent(n),
    onSuccess: () => {
      setName('')
      qc.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '添加失败', 'error'),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="学生管理" description="每位学生都有独立的批改、错题和统计。点卡片上的设置图标，可开通学生登录账号。" />

      <section data-tour="student-create" className="card p-4 sm:p-5" aria-labelledby="add-student-title">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()) }}>
          <label htmlFor="add-student-name" id="add-student-title" className="text-sm font-semibold">添加一位学生</label>
          <div className="mt-2.5 flex gap-2">
            <input id="add-student-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="学生姓名，如：小明" maxLength={32} className="input min-w-0 flex-1" autoComplete="off" />
            <button type="submit" disabled={!name.trim() || create.isPending} className="btn-primary shrink-0 px-4"><Icon name="plus" size={16} />{create.isPending ? '添加中…' : '添加学生'}</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-dim">之后选择对应学生上传作答即可；自己做题选择「我自己」。</p>
        </form>
      </section>

      <section aria-labelledby="student-list-title">
        <div className="mb-3 flex items-center justify-between"><h2 id="student-list-title" className="font-serif text-xl font-bold">学生列表</h2>{students.data && <span className="badge bg-surface-2 text-dim">{students.data.students.length} 人</span>}</div>
        {students.isPending ? (
          <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="skeleton h-44" />)}</div>
        ) : students.isError ? (
          <ErrorState error={students.error} onRetry={() => void students.refetch()} />
        ) : students.data.students.length === 0 ? (
          <EmptyState icon="users" title="还没有学生" description="先在上方添加一位学生，再开始拍照批改。" />
        ) : (
          <div className="grid items-start gap-3 md:grid-cols-2">{students.data.students.map((s) => <StudentRow key={s.id} student={s} />)}</div>
        )}
      </section>
    </div>
  )
}
