import { expect, it, vi } from 'vitest'
import { installModuleRecovery } from './moduleRecovery'

it('reloads once when Vite cannot preload an updated page module', () => {
  sessionStorage.clear()
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  installModuleRecovery()

  const first = new Event('vite:preloadError', { cancelable: true })
  window.dispatchEvent(first)
  window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))

  expect(first.defaultPrevented).toBe(true)
  expect(reload).toHaveBeenCalledTimes(1)
})
