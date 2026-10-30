import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Release } from '../types'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

const CHECK_INTERVAL = 6 * 60 * 60 * 1000

function versionParts(version: string) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null
}

export function isNewerVersion(candidate: string, current: string) {
  const left = versionParts(candidate)
  const right = versionParts(current)
  if (!left || !right) return false
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return false
}

export function AppUpdatePrompt() {
  const [currentVersion, setCurrentVersion] = useState('')
  const [update, setUpdate] = useState<Release | null>(null)
  const [dismissedTag, setDismissedTag] = useState<string | null>(null)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let mounted = true
    let checking = false
    let lastChecked = 0

    const check = async (force = false) => {
      if (checking || (!force && Date.now() - lastChecked < CHECK_INTERVAL)) return
      checking = true
      lastChecked = Date.now()
      try {
        const infoPromise = NativeApp.getInfo().catch(() => ({ version: '0.0.0' }))
        const [info, result] = await Promise.all([infoPromise, api.listReleases()])
        if (!mounted) return
        setCurrentVersion(info.version === '0.0.0' ? '' : info.version)
        const latest = result.releases.find((release) =>
          release.apk_size != null && !release.prerelease && isNewerVersion(release.tag, info.version),
        )
        if (latest && latest.tag !== dismissedTag) setUpdate(latest)
      } catch {
        // 更新检查失败不影响正常使用，下次回到前台会重试。
      } finally {
        checking = false
      }
    }

    void check(true)
    const listener = NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void check()
    }).catch(() => null)
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL)
    return () => {
      mounted = false
      window.clearInterval(timer)
      void listener.then((handle) => handle?.remove())
    }
  }, [dismissedTag])

  if (!update) return null

  return (
    <Dialog title="发现新版本" onClose={() => { setDismissedTag(update.tag); setUpdate(null) }}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950/35 dark:text-primary-300">
          <Icon name="download" size={22} />
        </span>
        <div>
          <p className="font-semibold text-ink">{update.name}</p>
          <p className="mt-1 text-sm leading-6 text-dim">当前版本 {currentVersion || '未知'}，可以更新到 {update.tag}。</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink2">下载后打开 APK 按提示安装即可，已有账号和学习数据不会受影响。</p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={() => { setDismissedTag(update.tag); setUpdate(null) }} className="btn-ghost px-4">稍后再说</button>
        <a href={`/api/releases/${encodeURIComponent(update.tag)}/apk`} className="btn-primary px-5">
          <Icon name="download" size={16} />下载更新
        </a>
      </div>
    </Dialog>
  )
}
