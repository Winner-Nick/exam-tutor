import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Icon } from '../components/Icon'
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
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 font-serif text-base font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
          {student.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) rename.mutate()
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={32}
                className="input w-36 px-2 py-1"
              />
              <button type="submit" disabled={rename.isPending} className="text-sm text-primary-600 dark:text-primary-400">
                保存
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-sm text-dim">
                取消
              </button>
            </form>
          ) : (
            <p className="truncate font-semibold">
              {student.name}
              {student.account_username && (
                <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-xs font-normal text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  @{student.account_username}
                </span>
              )}
            </p>
          )}
          <p className="mt-0.5 text-xs text-dim">
            {student.submission_count} 次批改
            {(student.wrong_total ?? 0) > 0 && ` · 累计错题 ${student.wrong_total}`}
          </p>
        </div>
        <Link
          to={`/?student=${student.id}`}
          className="btn-ghost px-2.5 py-1.5 text-sm text-primary-600 dark:text-primary-400"
        >
          去批改
        </Link>
        {!student.is_self && (
          <button
            onClick={() => setShowAccount((v) => !v)}
            title="登录账号管理"
            className={`icon-btn p-1.5 ${showAccount ? 'text-primary-600 dark:text-primary-400' : ''}`}
          >
            <Icon name="settings" size={16} />
          </button>
        )}
        {!editing && (
          <button onClick={() => setEditing(true)} title="改名" className="icon-btn p-1.5">
            <Icon name="edit" size={16} />
          </button>
        )}
        {!student.is_self && (
          <button
            onClick={() => {
              if (confirm(`确定删除学生「${student.name}」吗？其登录账号（如有）会一并注销。`)) del.mutate()
            }}
            title="删除"
            className="icon-btn p-1.5 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-900/30"
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
      {showAccount && !student.is_self && (
        <AccountPanel student={student} onClose={() => setShowAccount(false)} />
      )}
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
    <div className="mx-auto max-w-2xl space-y-4">
      <p className="text-sm text-ink2">
        管理你的学生。批改时选择对应学生，错题与统计将按学生分开记录；自己做题就选「我自己」。
        点学生卡片上的 <Icon name="settings" size={13} className="inline" /> 可开通登录账号，学生即可自行拍照上传作答。
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate(name.trim())
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="学生姓名，如：小明"
          maxLength={32}
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="btn-primary shrink-0 px-4 py-2"
        >
          <Icon name="plus" size={16} />
          {create.isPending ? '添加中…' : '添加学生'}
        </button>
      </form>

      {students.isPending ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-[74px] rounded-2xl" />
          ))}
        </div>
      ) : students.isError ? (
        <p className="py-12 text-center text-dim">加载失败，请刷新重试</p>
      ) : (
        <div className="space-y-3">
          {students.data.students.map((s) => (
            <StudentRow key={s.id} student={s} />
          ))}
        </div>
      )}
    </div>
  )
}
