import { Dialog } from './Dialog'

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认删除',
  pending = false,
  onConfirm,
  onClose,
}: {
  title: string
  description: string
  confirmLabel?: string
  pending?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog title={title} onClose={onClose} hideClose={pending}>
      <p className="text-sm leading-relaxed text-ink2">{description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={pending} className="btn-ghost px-4">取消</button>
        <button onClick={onConfirm} disabled={pending} className="btn-danger px-4">
          {pending ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
