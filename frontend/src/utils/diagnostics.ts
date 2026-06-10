/** 客户端诊断信息收集：随用户反馈自动上报，便于排查设备/内核相关问题。 */

const recentErrors: { at: string; msg: string }[] = []

/** 在应用入口安装全局错误缓冲（保留最近 20 条 JS 报错，随反馈上报）。 */
export function installErrorBuffer() {
  const push = (msg: string) => {
    recentErrors.push({ at: new Date().toLocaleTimeString('zh-CN'), msg: msg.slice(0, 300) })
    if (recentErrors.length > 20) recentErrors.shift()
  }
  addEventListener('error', (e) => push(String(e.message ?? e)))
  addEventListener('unhandledrejection', (e) =>
    push('Promise: ' + String((e as PromiseRejectionEvent).reason).slice(0, 280)),
  )
}

export function collectDiag(): Record<string, unknown> {
  let phColor: string | undefined
  try {
    const input = document.querySelector('input[placeholder]')
    if (input) phColor = getComputedStyle(input, '::placeholder').color
  } catch {
    /* 个别内核不支持伪元素参数 */
  }
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } }
  const supports = (q: string) => {
    try {
      return typeof CSS !== 'undefined' && !!CSS.supports?.(q)
    } catch {
      return false
    }
  }
  return {
    ua: navigator.userAgent,
    lang: navigator.language,
    vw: innerWidth,
    vh: innerHeight,
    dpr: devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    dark: document.documentElement.classList.contains('dark'),
    standalone: matchMedia('(display-mode: standalone)').matches,
    online: navigator.onLine,
    conn: nav.connection?.effectiveType,
    colorMix: supports('color: color-mix(in oklab, red 50%, transparent)'),
    oklch: supports('color: oklch(0.5 0.1 200)'),
    phColor,
    errors: recentErrors.slice(),
  }
}
