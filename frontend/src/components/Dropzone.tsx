import { useRef, useState } from 'react'

export function Dropzone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pick(files: FileList | null) {
    const f = files?.[0]
    if (f) onFile(f)
  }

  return (
    <div
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!busy) pick(e.dataTransfer.files)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        over
          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
          : 'border-slate-300 bg-white hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-primary-700'
      } ${busy ? 'pointer-events-none opacity-60' : ''}`}
    >
      <span className="text-3xl">📄</span>
      <p className="font-medium">{busy ? '正在上传…' : '点击或拖拽上传试卷 PDF'}</p>
      <p className="text-xs text-slate-400">支持已批改的扫描卷 · 最大 30MB / 30 页</p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
