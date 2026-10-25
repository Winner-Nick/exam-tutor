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
    <div className={`card text-center ${compact ? 'px-4 py-6' : 'px-5 py-16'}`} role="alert">
      <Icon name={status === 0 ? 'refresh' : 'alert'} size={compact ? 24 : 34} className="mx-auto text-rose-500" />
      <h2 className="mt-3 font-medium text-ink">{heading}</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-dim">{detail}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-outline mt-4 px-4">
          <Icon name="refresh" size={15} /> 重试
        </button>
      )}
    </div>
  )
}
