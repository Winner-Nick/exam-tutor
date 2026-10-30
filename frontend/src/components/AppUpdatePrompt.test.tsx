import { render, screen, waitFor } from '@testing-library/react'
import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../api'
import { AppUpdatePrompt, isNewerVersion } from './AppUpdatePrompt'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }))
vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn(), addListener: vi.fn() } }))
vi.mock('../api', () => ({ api: { listReleases: vi.fn() } }))

const release = {
  tag: 'v1.2.0', name: '错题小方 v1.2.0', body: '', published_at: null,
  prerelease: false, apk_size: 1000,
}

beforeEach(() => {
  vi.mocked(NativeApp.addListener).mockResolvedValue({ remove: vi.fn() } as never)
})

it('compares numeric versions without lexical ordering mistakes', () => {
  expect(isNewerVersion('v1.10.0', '1.9.9')).toBe(true)
  expect(isNewerVersion('v1.2.0', '1.2.0')).toBe(false)
  expect(isNewerVersion('v1.1.9', '1.2.0')).toBe(false)
})

it('does not check for APK updates in a browser', () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)
  render(<AppUpdatePrompt />)
  expect(api.listReleases).not.toHaveBeenCalled()
})

it('offers the newer APK to an outdated native app', async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
  vi.mocked(NativeApp.getInfo).mockResolvedValue({ version: '1.1.0' } as never)
  vi.mocked(api.listReleases).mockResolvedValue({ releases: [release] })
  render(<AppUpdatePrompt />)

  expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeInTheDocument()
  expect(screen.getByText('当前版本 1.1.0，可以更新到 v1.2.0。')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '下载更新' })).toHaveAttribute('href', '/api/releases/v1.2.0/apk')
})

it('stays quiet when the native app is already current', async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
  vi.mocked(NativeApp.getInfo).mockResolvedValue({ version: '1.2.0' } as never)
  vi.mocked(api.listReleases).mockResolvedValue({ releases: [release] })
  render(<AppUpdatePrompt />)

  await waitFor(() => expect(api.listReleases).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('offers updates to older shells without the native App plugin', async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
  vi.mocked(NativeApp.getInfo).mockRejectedValue(new Error('App plugin is not implemented'))
  vi.mocked(NativeApp.addListener).mockRejectedValue(new Error('App plugin is not implemented'))
  vi.mocked(api.listReleases).mockResolvedValue({ releases: [release] })
  render(<AppUpdatePrompt />)

  expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeInTheDocument()
  expect(screen.getByText('当前版本 未知，可以更新到 v1.2.0。')).toBeInTheDocument()
})
