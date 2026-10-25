import { Dialog } from './Dialog'

export function PaperViewer({
  urlFor,
  pageCount,
  onClose,
}: {
  urlFor: (n: number) => string
  pageCount: number
  onClose: () => void
}) {
  return (
    <Dialog title={`原卷 · 共 ${pageCount} 页`} onClose={onClose} className="max-w-4xl">
      <div className="space-y-4">
        {Array.from({ length: pageCount }, (_, index) => (
          <img
            key={index}
            src={urlFor(index + 1)}
            alt={`原卷第 ${index + 1} 页`}
            loading="lazy"
            className="mx-auto w-full rounded-lg border border-line bg-white"
          />
        ))}
      </div>
    </Dialog>
  )
}
