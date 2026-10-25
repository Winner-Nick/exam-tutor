import type { QueryClient } from '@tanstack/react-query'

export function invalidateLearningData(qc: QueryClient) {
  return Promise.all(
    ['jobs', 'job', 'papers', 'paper', 'mistakes', 'overview', 'students'].map((queryKey) =>
      qc.invalidateQueries({ queryKey: [queryKey] }),
    ),
  )
}

export function invalidateCreatedPaper(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ['papers'] })
}

export function invalidateCreatedSubmission(qc: QueryClient) {
  return Promise.all(
    ['jobs', 'papers', 'students'].map((queryKey) => qc.invalidateQueries({ queryKey: [queryKey] })),
  )
}

export function invalidateReviewData(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ['mistakes'] })
}

export function invalidateStudentLearningData(qc: QueryClient) {
  return Promise.all(
    ['students', 'jobs', 'job', 'mistakes', 'overview'].map((queryKey) =>
      qc.invalidateQueries({ queryKey: [queryKey] }),
    ),
  )
}
