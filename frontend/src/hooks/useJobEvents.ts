import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { Job } from '../types'

/**
 * 订阅作业 SSE：progress 增量更新缓存，job_done/job_error/question_explained
 * 触发整体重取。EventSource 自带重连；连接失败时返回 sseDown=true，
 * 由调用方降级为轮询（job 查询的 refetchInterval）。
 */
export function useJobEvents(jobId: string | undefined) {
  const qc = useQueryClient()
  const [sseDown, setSseDown] = useState(false)
  const failures = useRef(0)

  useEffect(() => {
    if (!jobId) return
    failures.current = 0
    const es = new EventSource(`/api/jobs/${jobId}/events`)

    const patchJob = (patch: Partial<Job>) => {
      qc.setQueryData<Job>(['job', jobId], (old) => (old ? { ...old, ...patch } : old))
    }

    es.addEventListener('open', () => {
      failures.current = 0
      setSseDown(false)
    })
    es.addEventListener('snapshot', (e) => {
      const snap = JSON.parse((e as MessageEvent).data) as Job
      qc.setQueryData<Job>(['job', jobId], (old) =>
        old ? { ...snap, questions: old.questions } : old,
      )
    })
    es.addEventListener('progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      patchJob({ stage: d.stage, progress: { done: d.done, total: d.total, label: d.label } })
    })
    es.addEventListener('job_done', () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    })
    es.addEventListener('job_error', () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    })
    es.addEventListener('question_explained', () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] })
    })
    es.addEventListener('error', () => {
      failures.current += 1
      if (failures.current >= 2) setSseDown(true) // 连续失败才降级轮询
    })

    return () => es.close()
  }, [jobId, qc])

  return { sseDown }
}
