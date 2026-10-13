import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { DonutChart } from '../components/DonutChart'
import { Icon } from '../components/Icon'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { compressPicked } from '../utils/compressImage'
import type { Job, User } from '../types'

function JobCard({ job, canDelete, onDelete }: { job: Job; canDelete: boolean; onDelete: () => void }) {
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
      className="card card-hover group relative cursor-pointer p-4"
    >
      <div className="flex items-start gap-3.5">
        {job.status === 'done' ? (
          <DonutChart correct={s.correct ?? 0} total={graded} size={56} />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
            {job.status === 'processing' ? (
              <Spinner className="h-6 w-6" />
            ) : (
              <Icon name="alert" size={22} className="text-rose-500" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold" title={title}>
            {title}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-dim">
            {job.student_name && (
              <>
                <Icon name="user" size={12} /> {job.student_name} ·
              </>
            )}
            {date}
            {job.meta?.total_questions ? ` · ${job.meta.total_questions} 题` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {job.status === 'processing' && (
              <span className="badge bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                {job.progress?.label || '处理中…'}
              </span>
            )}
            {job.status === 'error' && (
              <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
                处理失败
              </span>
            )}
            {job.status === 'done' && (
              <>
                {(s.wrong ?? 0) > 0 && (
                  <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
                    错 {s.wrong}
                  </span>
                )}
                {(s.unknown ?? 0) > 0 && (
                  <span className="badge bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                    待确认 {s.unknown}
                  </span>
                )}
                {(s.wrong ?? 0) === 0 && (s.unknown ?? 0) === 0 && (
                  <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <Icon name="party-popper" size={12} /> 全对
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {canDelete && job.status !== 'processing' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="删除"
            className="absolute top-2.5 right-2.5 rounded-lg p-2 text-dim hover:bg-rose-50 hover:text-rose-500 active:bg-rose-50 active:text-rose-500 dark:hover:bg-rose-900/30 dark:active:bg-rose-900/30"
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

const stepBadge =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 font-serif text-xs font-bold text-white shadow-sm'

export function DashboardPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = useOutletContext<User>()
  const isStudent = user.role === 'student'
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [studentId, setStudentId] = useState<number | null>(null)
  const [paperId, setPaperId] = useState<string>('')
  const [files, setFiles] = useState<File[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
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
    mutationFn: () => api.createSubmission(paperId, studentId!, files, usePaperFiles, setUploadPct),
    onSettled: () => setUploadPct(null),
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

  async function addFiles(list: FileList | null) {
    setPicking('正在处理…')
    try {
      const { files: fs, dropped } = await compressPicked(
        list, 12, files.length,
        (done, total) => setPicking(`处理照片 ${done}/${total}…`),
      )
      if (dropped > 0) toast(`一次最多上传 12 张，已忽略 ${dropped} 张`, 'error')
      if (fs.length) setFiles((old) => [...old, ...fs])
    } finally {
      setPicking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-5 p-5 sm:p-6">
        <h3 className="section-title flex items-center gap-2">
          <Icon name="pen" size={18} className="text-primary-600 dark:text-primary-400" />
          {isStudent ? '上传我的作答' : '批改新作业'}
        </h3>

        {/* 1. 选学生（学生账号默认就是自己，不展示） */}
        {!isStudent && (
          <div>
            <p className="mb-2.5 flex items-center gap-2 text-sm font-medium">
              <span className={stepBadge}>1</span> 谁做的题？
            </p>
            {students.isPending ? (
              <div className="flex gap-2">
                <div className="skeleton h-9 w-20 rounded-full" />
                <div className="skeleton h-9 w-20 rounded-full" />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {(students.data?.students ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStudentId(s.id)}
                    className={`chip ${studentId === s.id ? 'chip-active' : ''}`}
                  >
                    <Icon name="user" size={14} />
                    {s.is_self ? '我自己' : s.name}
                  </button>
                ))}
                <Link
                  to="/students"
                  className="flex items-center gap-0.5 text-sm text-primary-600 hover:underline dark:text-primary-400"
                >
                  <Icon name="plus" size={14} /> 管理学生
                </Link>
              </div>
            )}
          </div>
        )}

        {/* 2. 选试卷 */}
        <div>
          <p className="mb-2.5 flex items-center gap-2 text-sm font-medium">
            <span className={stepBadge}>{isStudent ? 1 : 2}</span> 做的哪份题？
          </p>
          {papers.isPending ? (
            <div className="skeleton h-10 max-w-md rounded-xl" />
          ) : readyPapers.length === 0 ? (
            <p className="text-sm text-dim">
              {isStudent ? (
                '老师还没有录入试卷，请先告诉老师录入'
              ) : (
                <>
                  试卷库还没有可用的试卷，先去
                  <Link to="/papers" className="mx-1 text-primary-600 hover:underline dark:text-primary-400">
                    录入试卷（题目+答案）
                  </Link>
                </>
              )}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={paperId}
                onChange={(e) => setPaperId(e.target.value)}
                className="input min-w-0 max-w-full flex-1 cursor-pointer sm:max-w-md"
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
              {!isStudent && (
                <Link
                  to="/papers"
                  className="flex items-center gap-0.5 text-sm text-primary-600 hover:underline dark:text-primary-400"
                >
                  <Icon name="plus" size={14} /> 新试卷
                </Link>
              )}
            </div>
          )}
        </div>

        {/* 3. 上传作答 */}
        <div>
          <p className="mb-2.5 flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className={stepBadge}>{isStudent ? 2 : 3}</span> 上传做题结果
            <span className="text-xs font-normal text-dim">
              一次最多 12 张；可以先拍一部分，之后在批改结果页随时「补拍补传」
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={usePaperFiles || !!picking}
              className="btn-outline border-dashed px-4 py-2.5"
            >
              <Icon name="camera" size={16} /> 拍照
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={usePaperFiles || !!picking}
              className="btn-outline border-dashed px-4 py-2.5"
            >
              {picking ? (
                <>
                  <Spinner className="h-4 w-4" /> {picking}
                </>
              ) : (
                <>
                  <Icon name="image" size={16} /> 相册 / 文件
                </>
              )}
            </button>
            {!isStudent && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-dim">
                <input
                  type="checkbox"
                  checked={usePaperFiles}
                  onChange={(e) => setUsePaperFiles(e.target.checked)}
                  className="rounded accent-primary-600"
                />
                学生直接答在试卷文件上（复用试卷扫描件，无需再传）
              </label>
            )}
          </div>
          {files.length > 0 && !usePaperFiles && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="badge bg-surface-2 text-ink2"
                  title={f.name}
                >
                  <Icon name="file-text" size={12} />
                  <span className="max-w-36 truncate">{f.name}</span>
                  <button
                    onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                    className="rounded-full p-0.5 hover:text-rose-500"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
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
          className="btn-primary w-full py-3 text-base sm:w-auto sm:px-10"
        >
          {submit.isPending ? (
            uploadPct != null && uploadPct < 100 ? (
              <>
                <Icon name="upload" size={17} /> 上传中 {uploadPct}%
              </>
            ) : (
              <>
                <Spinner className="h-4 w-4 text-white" /> 处理中…
              </>
            )
          ) : (
            isStudent ? '提交批改' : '开始批改'
          )}
        </button>
      </div>

      <div>
        <h3 className="section-title mb-3 flex items-center gap-2">
          <Icon name="list" size={18} className="text-primary-600 dark:text-primary-400" />
          最近批改
        </h3>
        {jobs.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-28 rounded-2xl" />
            ))}
          </div>
        ) : jobs.isError ? (
          <p className="py-12 text-center text-dim">加载失败，请刷新重试</p>
        ) : jobs.data.jobs.length === 0 ? (
          <div className="card py-14 text-center">
            <Icon name="pen" size={32} className="mx-auto text-dim" />
            <p className="mt-3 text-sm text-dim">还没有批改记录，从上面的三步开始吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.data.jobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                canDelete={!isStudent}
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
