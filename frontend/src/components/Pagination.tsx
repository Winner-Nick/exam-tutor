export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const current = Math.min(page, pages - 1)
  return (
    <nav className="flex items-center justify-center gap-3" aria-label="分页">
      <button className="btn-outline px-4" disabled={current === 0} onClick={() => onPage(current - 1)}>上一页</button>
      <span className="text-sm text-ink2" aria-live="polite">第 {current + 1} / {pages} 页，共 {total} 条</span>
      <button className="btn-outline px-4" disabled={current >= pages - 1} onClick={() => onPage(current + 1)}>下一页</button>
    </nav>
  )
}
