import { useEffect } from 'react'
import { useBeforeUnload } from 'react-router-dom'

export function useUploadGuard(active: boolean) {
  useBeforeUnload((event) => {
    if (active) event.preventDefault()
  })

  useEffect(() => {
    if (!active) return
    const guard = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.origin !== location.origin) return
      if (!window.confirm('上传尚未完成。离开会取消上传，确定离开吗？')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', guard, true)
    return () => document.removeEventListener('click', guard, true)
  }, [active])
}
