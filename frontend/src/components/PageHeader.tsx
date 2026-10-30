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
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 font-serif text-2xl leading-snug font-bold tracking-normal break-words text-ink sm:text-3xl">{title}</h1>
          {helpAnchor && (
            <Link
              to={`/guide#${helpAnchor}`}
              aria-label="帮助"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dim transition-colors hover:bg-surface-2 hover:text-primary-700 sm:w-auto sm:gap-1.5 sm:px-2 sm:text-sm sm:font-medium dark:hover:text-primary-300"
            >
              <Icon name="help-circle" size={17} /><span className="hidden sm:inline">帮助</span>
            </Link>
          )}
        </div>
        {description && <div className="mt-2 max-w-3xl text-sm leading-6 text-ink2">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
