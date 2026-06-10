import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { DonutChart } from '../components/DonutChart'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import type { Job } from '../types'

function JobCard({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const navigate = useNavigate()
  const title = job.paper_title || job.meta?.title || job.filename || '试卷'
  const date = new Date(job.created_at * 1000).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  })
  const s = job.stats
  const graded = (s.correct ?? 0) + (s.wrong ?? 0)

  return (
    <div
      onClick={() => navigate(`/jobs/${job.id}`)}
      className="group relative cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        {job.status === 'done' ? (
          <DonutChart correct={s.correct ?? 0} total={graded} size={56} />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center">
            {job.status === 'processing' ? (
              <Spinner className="h-6 w-6" />
            ) : (
              <span className="text-2xl">⚠️</span>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold" title={title}>
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {job.student_name && <>👤 {job.student_name} · </>}
            {date}
            {job.meta?.total_questions ? ` · ${job.meta.total_questions} 题` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {job.status === 'processing' && (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                {job.progress?.label || '处理中…'}
              </span>
            )}
            {job.status === 'error' && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                处理失败
              </span>
            )}
            {job.status === 'done' && (
              <>
                {(s.wrong ?? 0) > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                    错 {s.wrong}
                  </span>
                )}
                {(s.unknown ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">
                    待确认 {s.unknown}
                  </span>
                )}
                {(s.wrong ?? 0) === 0 && (s.unknown ?? 0) === 0 && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                    全对 🎉
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {job.status !== 'processing' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="删除"
            className="absolute top-3 right-3 hidden rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 group-hover:block dark:hover:bg-rose-900/30"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white'

export function DashboardPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [studentId, setStudentId] = useState<number | null>(null)
  const [paperId, setPaperId] = useState<string>('')
  const [files, setFiles] = useState<File[]>([])
  const [usePaperFiles, setUsePaperFiles] = useState(false)

  const students = useQuery({ queryKey: ['students'], queryFn: api.listStudents })
  const papers = useQuery({ queryKey: ['papers'], queryFn: api.listPapers })
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(),
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === 'processing') ? 4000 : false,
  })

  // 默认选中"我自己"；支持 /?student=ID&paper=ID 预选
  useEffect(() => {
    if (studentId == null && students.data) {
      const fromUrl = Number(params.get('student'))
      const hit = students.data.students.find((s) => s.id === fromUrl)
      setStudentId(hit?.id ?? students.data.students.find((s) => s.is_self)?.id ?? students.data.students[0]?.id ?? null)
    }
  }, [students.data, studentId, params])
  useEffect(() => {
    const fromUrl = params.get('paper')
    if (fromUrl && papers.data?.papers.some((p) => p.id === fromUrl)) setPaperId(fromUrl)
  }, [papers.data, params])

  const submit = useMutation({
    mutationFn: () => api.createSubmission(paperId, studentId!, files, usePaperFiles),
    onSuccess: ({ job_id }) => {
      setFiles([])
      setUsePaperFiles(false)
      qc.invalidateQueries({ queryKey: ['jobs'] })
      navigate(`/jobs/${job_id}`)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '提交失败，请重试', 'error'),
  })

  const del = useMutation({
    mutationFn: api.deleteJob,
    onSuccess: () => {
      toast('已删除')
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '删除失败', 'error'),
  })

  const readyPapers = (papers.data?.papers ?? []).filter((p) => p.status === 'ready')
  const canSubmit = !!paperId && studentId != null && (usePaperFiles || files.length > 0)

  function addFiles(list: FileList | null) {
    const fs = Array.from(list ?? [])
    if (fs.length) setFiles((old) => [...old, ...fs].slice(0, 12))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-bold">✏️ 批改新作业</h3>

        {/* 1. 选学生 */}
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <span className={stepBadge}>1</span> 谁做的题？
          </p>
          {students.isPending ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {(students.data?.students ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStudentId(s.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    studentId === s.id
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {s.is_self ? '🙋 ' : ''}
                  {s.name}
                </button>
              ))}
              <Link to="/students" className="text-sm text-primary-600 hover:underline">
                ＋ 管理学生
              </Link>
            </div>
          )}
        </div>

        {/* 2. 选试卷 */}
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <span className={stepBadge}>2</span> 做的哪份题？
          </p>
          {papers.isPending ? (
            <Spinner className="h-5 w-5" />
          ) : readyPapers.length === 0 ? (
            <p className="text-sm text-slate-400">
              试卷库还没有可用的试卷，先去
              <Link to="/papers" className="mx-1 text-primary-600 hover:underline">
                录入试卷（题目+答案）
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={paperId}
                onChange={(e) => setPaperId(e.target.value)}
                className="min-w-0 max-w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-md dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">— 选择试卷 —</option>
                {readyPapers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || '试卷'}（{p.question_count} 题
                    {p.question_count - p.answered_count > 0
                      ? `，${p.question_count - p.answered_count} 题缺答案`
                      : ''}
                    ）
                  </option>
                ))}
              </select>
              <Link to="/papers" className="text-sm text-primary-600 hover:underline">
                ＋ 新试卷
              </Link>
            </div>
          )}
        </div>

        {/* 3. 上传作答 */}
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <span className={stepBadge}>3</span> 上传做题结果
            <span className="text-xs font-normal text-slate-400">
              可以先拍一部分，之后在批改结果页随时「补拍补传」
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={usePaperFiles}
              className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm hover:border-primary-400 disabled:opacity-40 dark:border-slate-700"
            >
              📷 拍照
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={usePaperFiles}
              className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm hover:border-primary-400 disabled:opacity-40 dark:border-slate-700"
            >
              🖼 相册 / 文件
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={usePaperFiles}
                onChange={(e) => setUsePaperFiles(e.target.checked)}
                className="rounded"
              />
              学生直接答在试卷文件上（复用试卷扫描件，无需再传）
            </label>
          </div>
          {files.length > 0 && !usePaperFiles && (
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                  <span className="truncate">📄 {f.name}</span>
                  <button
                    onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                    className="text-slate-300 hover:text-rose-500"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        <button
          onClick={() => submit.mutate()}
          disabled={!canSubmit || submit.isPending}
          className="w-full rounded-xl bg-primary-600 py-2.5 font-medium text-white hover:bg-primary-700 disabled:opacity-50 sm:w-auto sm:px-8"
        >
          {submit.isPending ? '上传中…' : '🚀 开始批改'}
        </button>
      </div>

      <div>
        <h3 className="mb-3 font-bold">🗂 最近批改</h3>
        {jobs.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-7 w-7" />
          </div>
        ) : jobs.isError ? (
          <p className="py-12 text-center text-slate-400">加载失败，请刷新重试</p>
        ) : jobs.data.jobs.length === 0 ? (
          <p className="py-12 text-center text-slate-400">还没有批改记录</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.data.jobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                onDelete={() => {
                  if (confirm('确定删除这次批改及其讲解记录吗？')) del.mutate(j.id)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
