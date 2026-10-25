import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

export function PageHeader({
  title,
  description,
  actions,
  helpAnchor,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  helpAnchor?: string
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-2xl font-bold text-ink">{title}</h1>
          {helpAnchor && (
            <Link
              to={`/guide#${helpAnchor}`}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-primary-700 hover:underline dark:text-primary-300"
            >
              <Icon name="help-circle" size={16} /> 帮助
            </Link>
          )}
        </div>
        {description && <div className="mt-1 text-sm leading-relaxed text-ink2">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
