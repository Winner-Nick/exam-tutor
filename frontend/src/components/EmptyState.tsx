import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function EmptyState({
  icon = 'file-text',
  title,
  description,
  action,
}: {
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="subtle-panel border-dashed px-5 py-12 text-center shadow-none">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-line/70 bg-surface text-dim shadow-sm">
        <Icon name={icon} size={26} strokeWidth={1.6} />
      </span>
      <h2 className="mt-4 font-serif text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-dim">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
