import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Job } from '../types'
import { invalidateLearningData } from '../utils/query'

export function useJobEvents(jobId: string | undefined) {
  const qc = useQueryClient()
  const [sseDown, setSseDown] = useState(false)
  const failures = useRef(0)

  useEffect(() => {
    if (!jobId) return
    failures.current = 0
    const source = new EventSource(`/api/jobs/${jobId}/events`)
    const refreshJob = () => void qc.invalidateQueries({ queryKey: ['job', jobId] })
    const patchJob = (patch: Partial<Job>) => {
      qc.setQueryData<Job>(['job', jobId], (old) => (old ? { ...old, ...patch } : old))
    }
    const parse = <T,>(event: Event): T | null => {
      try {
        return JSON.parse((event as MessageEvent).data) as T
      } catch {
        refreshJob()
        return null
      }
    }

    source.addEventListener('open', () => {
      if (failures.current > 0) refreshJob()
      failures.current = 0
      setSseDown(false)
    })
    source.addEventListener('snapshot', (event) => {
      const snapshot = parse<Job>(event)
      if (!snapshot) return
      qc.setQueryData<Job>(['job', jobId], (old) => (old ? { ...snapshot, questions: old.questions } : old))
      refreshJob()
    })
    source.addEventListener('progress', (event) => {
      const data = parse<{ stage: string; done: number; total: number; label: string | null }>(event)
      if (!data) return
      patchJob({
        status: 'processing',
        stage: data.stage,
        progress: { done: data.done, total: data.total, label: data.label },
      })
    })
    source.addEventListener('job_done', () => void invalidateLearningData(qc))
    source.addEventListener('job_error', () => void invalidateLearningData(qc))
    source.addEventListener('question_explained', refreshJob)
    source.addEventListener('error', () => {
      failures.current += 1
      if (failures.current >= 2) setSseDown(true)
      if (failures.current === 2) void api.me().catch(() => undefined)
    })
    return () => source.close()
  }, [jobId, qc])

  return { sseDown }
}
