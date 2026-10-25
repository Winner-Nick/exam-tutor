import type { QueryClient } from '@tanstack/react-query'

export function invalidateLearningData(qc: QueryClient) {
  return Promise.all(
    ['jobs', 'job', 'papers', 'paper', 'mistakes', 'overview', 'students'].map((queryKey) =>
      qc.invalidateQueries({ queryKey: [queryKey] }),
    ),
  )
}
