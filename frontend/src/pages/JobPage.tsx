import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, pageImageUrl } from '../api'
import { ChatPanel } from '../components/ChatPanel'
import { DonutChart } from '../components/DonutChart'
import { PaperViewer } from '../components/PaperViewer'
import { QuestionDetail } from '../components/QuestionDetail'
import { QuestionGrid } from '../components/QuestionGrid'
import { Spinner } from '../components/Spinner'
import { StageStepper } from '../components/StageStepper'
import { useToast } from '../components/Toast'
import { useJobEvents } from '../hooks/useJobEvents'
import { useUi } from '../store'
import { compressPicked } from '../utils/compressImage'
import type { Job } from '../types'

function StatsBar({ job }: { job: Job }) {
  const s = job.stats
  const graded = (s.correct ?? 0) + (s.wrong ?? 0)
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <DonutChart correct={s.correct ?? 0} total={graded} size={72} />
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <span>✅ 答对 <b className="text-emerald-600">{s.correct ?? 0}</b></span>
        <span>❌ 答错 <b className="text-rose-600">{s.wrong ?? 0}</b></span>
        <span>❓ 待确认 <b className="text-amber-600">{s.unknown ?? 0}</b></span>
        <span>📝 主观题 <b className="text-violet-600">{s.subjective ?? 0}</b></span>
      </div>
    </div>
  )
}

export function JobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const qc = useQueryClient()
  const toast = useToast()
  const { selectedQid, setSelectedQid, mobileTab, setMobileTab, setFilter } = useUi()
  const [showPaper, setShowPaper] = useState(false)
  const [picking, setPicking] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const moreFilesRef = useRef<HTMLInputElement>(null)
  const { sseDown } = useJobEvents(jobId)

  const addFiles = useMutation({
    mutationFn: (files: File[]) => api.addSubmissionFiles(jobId!, files, setUploadPct),
    onSettled: () => setUploadPct(null),
    onSuccess: () => {
      toast('已上传，正在重新识别判分')
      qc.invalidateQueries({ queryKey: ['job', jobId] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '上传失败', 'error'),
  })

  const jobQ = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId,
    // 处理中始终兜底轮询（代理层可能缓冲 SSE）；SSE 失联时加快频率
    refetchInterval: (q) =>
      q.state.data?.status === 'processing' ? (sseDown ? 3000 : 5000) : false,
  })

  // 切换作业时重置选中态
  useEffect(() => {
    setSelectedQid(null)
    setFilter('all')
    setMobileTab('questions')
  }, [jobId, setSelectedQid, setFilter, setMobileTab])

  if (jobQ.isPending)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    )
  if (jobQ.isError)
    return (
      <div className="py-20 text-center text-slate-400">
        <p>作业不存在或已被删除</p>
        <Link to="/" className="mt-2 inline-block text-primary-600">
          返回试卷列表
        </Link>
      </div>
    )

  const job = jobQ.data
  const title = job.meta?.title || job.filename || '试卷'

  if (job.status === 'processing') {
    return (
      <div className="py-16">
        <h2 className="mb-10 text-center text-lg font-bold">{title}</h2>
        <StageStepper job={job} />
        <p className="mt-8 text-center text-xs text-slate-400">
          判分完成后立即可看结果，错题讲解会在后台陆续生成
        </p>
      </div>
    )
  }

  if (job.status === 'error') {
    return (
      <div className="py-20 text-center">
        <p className="text-3xl">😵</p>
        <p className="mt-3 font-medium">处理失败</p>
        <p className="mt-1 text-sm text-slate-400">{job.error}</p>
        <div className="mt-4 flex justify-center gap-3 text-sm">
          {job.kind === 'submission' && (
            <label className="cursor-pointer rounded-xl bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700">
              {addFiles.isPending
                ? uploadPct != null && uploadPct < 100
                  ? `⬆️ 上传 ${uploadPct}%`
                  : '上传中…'
                : picking
                  ? '⏳ 正在处理照片…'
                  : '📷 重新拍照上传'}
              <input
                type="file"
                multiple
                accept=".pdf,application/pdf,image/*"
                className="hidden"
                onChange={async (e) => {
                  setPicking(true)
                  try {
                    const { files: fs, dropped } = await compressPicked(e.target.files, 12)
                    e.target.value = ''
                    if (dropped > 0) toast(`一次最多上传 12 张，已忽略 ${dropped} 张`, 'error')
                    if (fs.length) addFiles.mutate(fs)
                  } finally {
                    setPicking(false)
                  }
                }}
              />
            </label>
          )}
          <Link to="/" className="self-center text-primary-600">
            返回首页
          </Link>
        </div>
      </div>
    )
  }

  const questions = job.questions ?? []
  const selected = questions.find((q) => q.id === selectedQid) ?? null

  // 移动端答疑 Tab：隐藏标题与统计，给聊天让出高度（输入框必须可见）
  const chatActive = mobileTab === 'chat'

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      <div
        className={`flex-wrap items-center justify-between gap-2 ${
          chatActive ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          {job.student_name && (
            <p className="text-xs text-slate-400">
              👤 {job.student_name}
              {job.paper_id && (
                <>
                  {' · '}
                  <Link to={`/papers/${job.paper_id}`} className="text-primary-600 hover:underline dark:text-primary-400">
                    查看试卷与答案
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {job.kind === 'submission' && (
            <button
              onClick={() => moreFilesRef.current?.click()}
              disabled={addFiles.isPending || picking}
              title="还有没拍的页面？继续拍照补传，已识别的部分不会丢"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-primary-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
            >
              {addFiles.isPending
                ? uploadPct != null && uploadPct < 100
                  ? `⬆️ 上传 ${uploadPct}%`
                  : '上传中…'
                : picking
                  ? '⏳ 正在处理照片…'
                  : '📷 补拍补传'}
            </button>
          )}
          <button
            onClick={() => setShowPaper(true)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900"
          >
            📖 查看原卷
          </button>
        </div>
      </div>

      <input
        ref={moreFilesRef}
        type="file"
        multiple
        accept=".pdf,application/pdf,image/*"
        className="hidden"
        onChange={async (e) => {
          setPicking(true)
          try {
            const { files: fs, dropped } = await compressPicked(e.target.files, 12)
            e.target.value = ''
            if (dropped > 0) toast(`一次最多上传 12 张，已忽略 ${dropped} 张`, 'error')
            if (fs.length) addFiles.mutate(fs)
          } finally {
            setPicking(false)
          }
        }}
      />

      <div className={chatActive ? 'hidden lg:block' : ''}>
        <StatsBar job={job} />
      </div>

      {/* 桌面三栏 / 移动单栏 + 底部 Tab */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <section
          className={`rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${
            mobileTab !== 'questions' ? 'hidden lg:block' : ''
          }`}
        >
          <QuestionGrid questions={questions} />
        </section>

        <section
          className={`rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${
            mobileTab !== 'detail' ? 'hidden lg:block' : ''
          }`}
        >
          {selected ? (
            <QuestionDetail job={job} question={selected} />
          ) : (
            <p className="py-16 text-center text-sm text-slate-400">
              <span className="lg:hidden">在「题目」中点击题号，查看该题详情与讲解</span>
              <span className="hidden lg:inline">从左侧选择一道题查看详情与讲解</span>
            </p>
          )}
        </section>

        <section
          className={`rounded-2xl border border-slate-200 bg-white p-4 lg:h-[640px] dark:border-slate-800 dark:bg-slate-900 ${
            mobileTab !== 'chat'
              ? 'hidden lg:block'
              : 'h-[calc(100dvh-10.5rem)] min-h-[320px]'
          }`}
        >
          <ChatPanel jobId={job.id} question={selected} onClearFocus={() => setSelectedQid(null)} />
        </section>
      </div>

      {/* 移动端底部 Tab（pb 适配 iPhone Home 指示条安全区） */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        {(
          [
            { k: 'questions', label: '题目', icon: '🔢' },
            { k: 'detail', label: '详情', icon: '📋' },
            { k: 'chat', label: '答疑', icon: '💬' },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setMobileTab(t.k)}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs ${
              mobileTab === t.k ? 'font-semibold text-primary-600' : 'text-slate-400'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {showPaper && job.page_count && (
        <PaperViewer
          urlFor={(n) => pageImageUrl(job.id, n)}
          pageCount={job.page_count}
          onClose={() => setShowPaper(false)}
        />
      )}
    </div>
  )
}
