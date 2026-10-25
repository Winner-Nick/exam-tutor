import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { invalidateCreatedPaper, invalidateCreatedSubmission, invalidateReviewData, invalidateStudentLearningData } from './query'

function client() {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)
  return { qc, invalidate }
}

it('invalidates only mistakes after review actions', async () => {
  const { qc, invalidate } = client()
  await invalidateReviewData(qc)
  expect(invalidate).toHaveBeenCalledOnce()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mistakes'] })
})

it('invalidates learning data affected by a student rename', async () => {
  const { qc, invalidate } = client()
  await invalidateStudentLearningData(qc)
  expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
    ['students'], ['jobs'], ['job'], ['mistakes'], ['overview'],
  ])
})

it('uses narrow invalidation for create flows', async () => {
  const { qc, invalidate } = client()
  await invalidateCreatedPaper(qc)
  await invalidateCreatedSubmission(qc)
  expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
    ['papers'], ['jobs'], ['papers'], ['students'],
  ])
})
