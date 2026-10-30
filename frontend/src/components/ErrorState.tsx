import { ApiError } from '../api'
import { Icon } from './Icon'

export function ErrorState({
  error,
  onRetry,
  title,
  compact = false,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
  compact?: boolean
}) {
  const status = error instanceof ApiError ? error.status : 0
  const heading = title ?? (status === 404 ? '内容不存在或已删除' : status === 0 ? '网络连接失败' : '加载失败')
  const detail =
    error instanceof ApiError
      ? error.message
      : '暂时无法连接服务器，请检查网络后重试。你的输入和已选文件不会因重试而丢失。'
  return (
    <div className={`card border-rose-200/70 text-center dark:border-rose-900/50 ${compact ? 'px-4 py-6' : 'px-5 py-14'}`} role="alert">
      <span className="mx-auto flex h-13 w-13 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
        <Icon name={status === 0 ? 'refresh' : 'alert'} size={compact ? 23 : 28} />
      </span>
      <h2 className="mt-4 font-serif text-lg font-bold text-ink">{heading}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-dim">{detail}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-outline mt-5 px-5">
          <Icon name="refresh" size={15} /> 重新加载
        </button>
      )}
    </div>
  )
}
