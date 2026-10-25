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
    <div className="card px-5 py-14 text-center">
      <Icon name={icon} size={34} className="mx-auto text-dim" />
      <h2 className="mt-3 font-medium text-ink">{title}</h2>
      {description && <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-dim">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
