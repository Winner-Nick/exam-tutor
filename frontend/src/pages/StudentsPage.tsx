import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import type { Student } from '../types'

function StudentRow({ student }: { student: Student }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(student.name)

  const rename = useMutation({
    mutationFn: () => api.renameStudent(student.id, name.trim()),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['students'] })
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
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-lg dark:bg-primary-900/40">
        {student.is_self ? '🙋' : '🧑‍🎓'}
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
              className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button type="submit" disabled={rename.isPending} className="text-sm text-primary-600">
              保存
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-400">
              取消
            </button>
          </form>
        ) : (
          <p className="truncate font-semibold">{student.name}</p>
        )}
        <p className="mt-0.5 text-xs text-slate-400">
          {student.submission_count} 次批改
          {(student.wrong_total ?? 0) > 0 && ` · 累计错题 ${student.wrong_total}`}
        </p>
      </div>
      <Link
        to={`/?student=${student.id}`}
        className="rounded-lg px-2 py-1 text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30"
      >
        去批改
      </Link>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          title="改名"
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-800"
        >
          ✏️
        </button>
      )}
      {!student.is_self && (
        <button
          onClick={() => {
            if (confirm(`确定删除学生「${student.name}」吗？`)) del.mutate()
          }}
          title="删除"
          className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-900/30"
        >
          🗑
        </button>
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
      <p className="text-sm text-slate-500 dark:text-slate-400">
        管理你的学生。批改时选择对应学生，错题与统计将按学生分开记录；自己做题就选「我自己」。
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
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {create.isPending ? '添加中…' : '＋ 添加学生'}
        </button>
      </form>

      {students.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-7 w-7" />
        </div>
      ) : students.isError ? (
        <p className="py-12 text-center text-slate-400">加载失败，请刷新重试</p>
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
