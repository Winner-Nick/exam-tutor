import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, pageImageUrl } from '../api'
import { ChatPanel } from '../components/ChatPanel'
import { DonutChart } from '../components/DonutChart'
import { Icon } from '../components/Icon'
import { PaperViewer } from '../components/PaperViewer'
import { QuestionDetail } from '../components/QuestionDetail'
import { QuestionGrid } from '../components/QuestionGrid'
import { Spinner } from '../components/Spinner'
import { StageStepper } from '../components/StageStepper'
import { useToast } from '../components/Toast'
import { useJobEvents } from '../hooks/useJobEvents'
import { useUi } from '../store'
import { compressPicked } from '../utils/compressImage'
import type { Job, User } from '../types'

function StatsBar({ job }: { job: Job }) {
  const s = job.stats
  const graded = (s.correct ?? 0) + (s.wrong ?? 0)
  const items = [
    { label: '答对', value: s.correct ?? 0, cls: 'text-emerald-600 dark:text-emerald-400' },
    { label: '答错', value: s.wrong ?? 0, cls: 'text-rose-600 dark:text-rose-400' },
    { label: '待确认', value: s.unknown ?? 0, cls: 'text-amber-600 dark:text-amber-400' },
    { label: '主观题', value: s.subjective ?? 0, cls: 'text-violet-600 dark:text-violet-400' },
  ]
  return (
    <div className="card flex items-center gap-4 p-4 sm:gap-6 sm:px-6">
      <DonutChart correct={s.correct ?? 0} total={graded} size={72} />
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="text-center sm:text-left">
            <p className={`font-serif text-xl font-bold ${it.cls}`}>{it.value}</p>
            <p className="text-xs text-dim">{it.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function JobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const qc = useQueryClient()
  const toast = useToast()
  const user = useOutletContext<User>()
  const isStudent = user.role === 'student'
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
      <div className="py-20 text-center text-dim">
        <p>作业不存在或已被删除</p>
        <Link to="/" className="mt-2 inline-block text-primary-600 dark:text-primary-400">
          返回批改列表
        </Link>
      </div>
    )

  const job = jobQ.data
  const title = job.paper_title || job.meta?.title || job.filename || '试卷'

  if (job.status === 'processing') {
    return (
      <div className="py-16">
        <h2 className="mb-10 text-center font-serif text-xl font-bold">{title}</h2>
        <StageStepper job={job} />
        <p className="mt-8 text-center text-xs text-dim">
          判分完成后立即可看结果，错题讲解会在后台陆续生成
        </p>
      </div>
    )
  }

  if (job.status === 'error') {
    return (
      <div className="py-20 text-center">
        <Icon name="alert" size={40} className="mx-auto text-rose-400" />
        <p className="mt-3 font-medium">处理失败</p>
        <p className="mt-1 text-sm text-dim">{job.error}</p>
        <div className="mt-4 flex justify-center gap-3 text-sm">
          {job.kind === 'submission' && (
            <label className="btn-primary cursor-pointer px-4 py-2">
              {addFiles.isPending
                ? uploadPct != null && uploadPct < 100
                  ? `上传 ${uploadPct}%`
                  : '上传中…'
                : picking
                  ? '正在处理照片…'
                  : '重新拍照上传'}
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
          <Link to="/" className="btn-outline self-center px-4 py-2">
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
          <h2 className="truncate font-serif text-xl font-bold">{title}</h2>
          {job.student_name && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-dim">
              <Icon name="user" size={12} /> {job.student_name}
              {job.paper_id && !isStudent && (
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
              className="btn-outline px-3 py-1.5"
            >
              {addFiles.isPending ? (
                uploadPct != null && uploadPct < 100 ? (
                  `上传 ${uploadPct}%`
                ) : (
                  '上传中…'
                )
              ) : picking ? (
                '正在处理照片…'
              ) : (
                <>
                  <Icon name="camera" size={15} /> 补拍补传
                </>
              )}
            </button>
          )}
          <button onClick={() => setShowPaper(true)} className="btn-outline px-3 py-1.5">
            <Icon name="book-open" size={15} /> 查看原卷
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
        <section className={`card p-4 ${mobileTab !== 'questions' ? 'hidden lg:block' : ''}`}>
          <QuestionGrid questions={questions} />
        </section>

        <section className={`card p-5 ${mobileTab !== 'detail' ? 'hidden lg:block' : ''}`}>
          {selected ? (
            <QuestionDetail job={job} question={selected} canEdit={!isStudent} />
          ) : (
            <div className="py-16 text-center">
              <Icon name="grid" size={28} className="mx-auto text-dim" />
              <p className="mt-3 text-sm text-dim">
                <span className="lg:hidden">在「题目」中点击题号，查看该题详情与讲解</span>
                <span className="hidden lg:inline">从左侧选择一道题查看详情与讲解</span>
              </p>
            </div>
          )}
        </section>

        <section
          className={`card p-4 lg:h-[640px] ${
            mobileTab !== 'chat'
              ? 'hidden lg:block'
              : 'h-[calc(100dvh-10.5rem)] min-h-[320px]'
          }`}
        >
          <ChatPanel jobId={job.id} question={selected} onClearFocus={() => setSelectedQid(null)} />
        </section>
      </div>

      {/* 移动端底部 Tab（pb 适配 iPhone Home 指示条安全区） */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {(
          [
            { k: 'questions', label: '题目', icon: 'grid' },
            { k: 'detail', label: '详情', icon: 'file-text' },
            { k: 'chat', label: '答疑', icon: 'chat' },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setMobileTab(t.k)}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
              mobileTab === t.k ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-dim'
            }`}
          >
            <Icon name={t.icon} size={19} />
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
