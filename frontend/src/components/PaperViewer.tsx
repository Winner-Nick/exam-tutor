import { useEffect } from 'react'
import { Icon } from './Icon'

export function PaperViewer({
  urlFor,
  pageCount,
  onClose,
}: {
  urlFor: (n: number) => string
  pageCount: number
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/85 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">原卷 · 共 {pageCount} 页</span>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/10"
        >
          关闭 <Icon name="x" size={15} />
        </button>
      </div>
      <div
        className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {Array.from({ length: pageCount }, (_, i) => (
          <img
            key={i}
            src={urlFor(i + 1)}
            alt={`第 ${i + 1} 页`}
            loading="lazy"
            className="mx-auto w-full max-w-3xl rounded-lg bg-white shadow-xl"
          />
        ))}
      </div>
    </div>
  )
}
