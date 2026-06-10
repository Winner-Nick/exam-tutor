import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { DonutChart } from '../components/DonutChart'
import { Dropzone } from '../components/Dropzone'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import type { Job } from '../types'

function JobCard({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const navigate = useNavigate()
  const title = job.meta?.title || job.filename || '试卷'
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
            {date} · {job.page_count ? `${job.page_count} 页` : ''}
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

export function DashboardPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()

  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === 'processing') ? 4000 : false,
  })

  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: ({ job_id }) => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      navigate(`/jobs/${job_id}`)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '上传失败，请重试', 'error'),
  })

  const del = useMutation({
    mutationFn: api.deleteJob,
    onSuccess: () => {
      toast('已删除')
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '删除失败', 'error'),
  })

  return (
    <div className="space-y-6">
      <Dropzone
        busy={upload.isPending}
        onFile={(f) => {
          if (!f.name.toLowerCase().endsWith('.pdf')) {
            toast('请上传 PDF 文件', 'error')
            return
          }
          upload.mutate(f)
        }}
      />

      {jobs.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-7 w-7" />
        </div>
      ) : jobs.isError ? (
        <p className="py-12 text-center text-slate-400">加载失败，请刷新重试</p>
      ) : jobs.data.jobs.length === 0 ? (
        <p className="py-12 text-center text-slate-400">还没有试卷，上传第一份试卷开始吧</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.data.jobs.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              onDelete={() => {
                if (confirm('确定删除这份试卷及其全部讲解记录吗？')) del.mutate(j.id)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
