export function emptyPageTarget(
  page: number,
  total: number,
  pageSize: number,
  itemCount: number | undefined,
) {
  if (itemCount !== 0 || total <= 0 || page <= 0) return null
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  return Math.min(page - 1, lastPage)
}
