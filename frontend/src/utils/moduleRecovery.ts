const LAST_RELOAD_KEY = 'et-module-recovery-at'

export function installModuleRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    const now = Date.now()
    try {
      const previous = Number(sessionStorage.getItem(LAST_RELOAD_KEY)) || 0
      if (now - previous < 60_000) return
      sessionStorage.setItem(LAST_RELOAD_KEY, String(now))
    } catch {
      // 存储不可用时仍允许本次恢复。
    }
    window.location.reload()
  })
}
