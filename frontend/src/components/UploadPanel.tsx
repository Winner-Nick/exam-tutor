import { useEffect, useId, useState, type DragEvent, type ReactNode, type Ref } from 'react'
import { Icon } from './Icon'
import { Spinner } from './Spinner'

function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function FileDropzone({
  inputRef,
  onFiles,
  disabled = false,
  picking = null,
  remaining,
  limit,
  title = '上传照片或 PDF',
  description,
  browseLabel = '选择文件',
  className = '',
}: {
  inputRef?: Ref<HTMLInputElement>
  onFiles: (files: FileList | null) => void
  disabled?: boolean
  picking?: string | boolean | null
  remaining: number
  limit: number
  title?: string
  description?: ReactNode
  browseLabel?: string
  className?: string
}) {
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const unavailable = disabled || remaining === 0

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    if (!unavailable) onFiles(event.dataTransfer.files)
  }

  function dragLeave(event: DragEvent<HTMLButtonElement>) {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
  }

  return (
    <div className={className}>
      <button
        type="button"
        disabled={unavailable}
        onClick={() => document.getElementById(inputId)?.click()}
        onDragEnter={(event) => { event.preventDefault(); if (!unavailable) setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); if (!unavailable) setDragging(true) }}
        onDragLeave={dragLeave}
        onDrop={drop}
        className={`dropzone ${dragging ? 'dropzone-active' : ''}`}
        aria-label={`${title}，${browseLabel}`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line/70 bg-surface text-primary-600 shadow-sm dark:text-primary-300">
          {picking ? <Spinner className="h-5 w-5" /> : <Icon name="upload" size={23} />}
        </span>
        <span className="mt-3 text-sm font-semibold text-ink">{typeof picking === 'string' ? picking : title}</span>
        <span className="mt-1 text-xs leading-5 text-dim">{picking ? '正在处理，请稍候' : description ?? <>支持拖放，或<span className="font-medium text-primary-700 dark:text-primary-300">{browseLabel}</span></>}</span>
        <span className="mt-2 text-[11px] text-dim">还可添加 {remaining} 个，共最多 {limit} 个</span>
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        disabled={unavailable}
        accept=".pdf,application/pdf,image/*"
        className="hidden"
        onChange={(event) => { onFiles(event.target.files); event.target.value = '' }}
      />
    </div>
  )
}

export function SelectedFileList({
  files,
  onRemove,
  disabled = false,
  label = '已选文件',
}: {
  files: File[]
  onRemove: (index: number) => void
  disabled?: boolean
  label?: string
}) {
  const [previews, setPreviews] = useState<(string | null)[]>([])

  useEffect(() => {
    const next = files.map((file) => {
      if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return null
      return URL.createObjectURL(file)
    })
    setPreviews(next)
    return () => {
      if (typeof URL.revokeObjectURL !== 'function') return
      next.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    }
  }, [files])

  if (files.length === 0) return null
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label={label}>
      {files.map((file, index) => (
        <li key={`${file.name}-${file.lastModified}-${file.size}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-line/70 bg-surface-2/45 p-2.5" title={file.name}>
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line/60 bg-surface text-dim">
            <Icon name={file.type === 'application/pdf' ? 'file-text' : 'image'} size={19} />
            {previews[index] && <img src={previews[index]!} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} />}
          </span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{file.name}</span><span className="mt-0.5 block text-xs text-dim">{fileSize(file.size)}{file.type === 'application/pdf' ? ' · PDF' : ''}</span></span>
          <button type="button" disabled={disabled} onClick={() => onRemove(index)} className="icon-btn h-9 w-9 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" aria-label={`移除 ${file.name}`}><Icon name="x" size={15} /></button>
        </li>
      ))}
    </ul>
  )
}

export function UploadProgress({
  percent,
  onCancel,
  label = '正在上传文件',
}: {
  percent: number | null
  onCancel: () => void
  label?: string
}) {
  const uploading = percent != null && percent < 100
  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/70 p-3.5 dark:border-primary-900/60 dark:bg-primary-950/25" role="status">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-primary-800 dark:text-primary-200">{uploading ? `${label} ${percent}%` : '文件已上传，等待服务器接收…'}</span>
        <button type="button" onClick={onCancel} className="btn-ghost min-h-9 shrink-0 px-2 text-xs text-rose-700 dark:text-rose-300">取消上传</button>
      </div>
      <progress aria-label={label} className="mt-2 h-1.5 w-full appearance-none overflow-hidden rounded-full border-0 bg-primary-100 text-primary-600 accent-primary-600" max={100} value={uploading ? percent : undefined} />
    </div>
  )
}
