import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Markdown } from '../components/Markdown'
import { Spinner } from '../components/Spinner'
import type { Release } from '../types'

function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function ReleaseCard({ release, latest }: { release: Release; latest: boolean }) {
  return (
    <div className="relative pl-10">
      {/* 时间线节点 */}
      <span
        className={`absolute top-1.5 left-2.5 h-3.5 w-3.5 rounded-full ring-4 ${
          latest
            ? 'bg-primary-500 ring-primary-100 dark:ring-primary-900/50'
            : 'bg-slate-300 ring-slate-100 dark:bg-slate-600 dark:ring-slate-800'
        }`}
      />
      <div
        className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
          latest
            ? 'border-primary-200 shadow-primary-100/50 dark:border-primary-800'
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold">{release.name}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {release.tag}
          </span>
          {latest && (
            <span className="rounded-full bg-primary-600 px-2 py-0.5 text-xs font-semibold text-white">
              最新版
            </span>
          )}
          <span className="ml-auto text-xs text-slate-400">{fmtDate(release.published_at)}</span>
        </div>

        {release.body && (
          <div className="md mt-3 text-sm text-slate-600 dark:text-slate-300">
            <Markdown text={release.body} />
          </div>
        )}

        {release.apk_size != null && (
          <a
            href={`/api/releases/${encodeURIComponent(release.tag)}/apk`}
            className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              latest
                ? 'bg-primary-600 text-white shadow-md shadow-primary-600/30 hover:bg-primary-700'
                : 'border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-600 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            ⬇️ 下载 APK
            <span className={latest ? 'text-primary-200' : 'text-slate-400'}>{fmtSize(release.apk_size)}</span>
          </a>
        )}
      </div>
    </div>
  )
}

export function DownloadPage() {
  const q = useQuery({ queryKey: ['releases'], queryFn: api.listReleases, staleTime: 300_000 })
  const releases = q.data?.releases ?? []
  const latest = releases.find((r) => r.apk_size != null && !r.prerelease) ?? releases[0]

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 via-white to-white dark:from-slate-950 dark:via-slate-950 dark:to-slate-950">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-primary-200/40 blur-3xl dark:bg-primary-900/30" />
        <div className="relative mx-auto max-w-2xl px-4 pt-14 pb-10 text-center">
          <img
            src="/icons/icon-192.png"
            alt="错题家教"
            className="mx-auto h-24 w-24 rounded-3xl shadow-xl shadow-primary-600/20"
          />
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight">错题家教</h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            拍照上传作答 · 自动判分 · AI 讲解每一道错题
          </p>

          {latest?.apk_size != null && (
            <div className="mt-7">
              <a
                href={`/api/releases/${encodeURIComponent(latest.tag)}/apk`}
                className="inline-flex items-center gap-2.5 rounded-2xl bg-primary-600 px-8 py-3.5 text-lg font-semibold text-white shadow-lg shadow-primary-600/30 transition-transform hover:-translate-y-0.5 hover:bg-primary-700"
              >
                ⬇️ 下载安卓版
                <span className="text-sm font-normal text-primary-200">
                  {latest.tag} · {fmtSize(latest.apk_size)}
                </span>
              </a>
              <p className="mt-3 text-xs text-slate-400">
                安装时如提示「未知来源」，允许本次安装即可
              </p>
            </div>
          )}

          <div className="mx-auto mt-8 grid max-w-md gap-3 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
              <p className="text-sm font-semibold">📱 iPhone 用户</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                用 Safari 打开本站 → 分享按钮 → 「添加到主屏幕」，即可像 App 一样使用
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
              <p className="text-sm font-semibold">🔄 自动更新</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                App 内容随网页自动更新，无需重装；仅图标等外壳变化时才需下载新版
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 版本历史 */}
      <div className="mx-auto max-w-2xl px-4 pb-16">
        <h2 className="mb-5 text-sm font-semibold tracking-wider text-slate-400 uppercase">
          版本历史
        </h2>
        {q.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-7 w-7" />
          </div>
        ) : q.isError ? (
          <p className="py-12 text-center text-sm text-slate-400">版本列表加载失败，请稍后刷新重试</p>
        ) : releases.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">还没有发布版本</p>
        ) : (
          <div className="relative space-y-5">
            {/* 时间线竖线 */}
            <span className="absolute top-2 bottom-2 left-4 w-px bg-slate-200 dark:bg-slate-800" />
            {releases.map((r) => (
              <ReleaseCard key={r.tag} release={r} latest={r.tag === latest?.tag} />
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-sm">
          <Link to="/" className="text-primary-600 hover:underline dark:text-primary-400">
            🌐 直接使用网页版 →
          </Link>
        </p>
      </div>
    </div>
  )
}
