import { useEffect } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'

export function useUploadGuard(active: boolean) {
  const blocker = useBlocker(active)

  useBeforeUnload((event) => {
    if (active) event.preventDefault()
  })

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('上传尚未完成。离开会取消上传，确定离开吗？')) blocker.proceed()
    else blocker.reset()
  }, [blocker])
}
