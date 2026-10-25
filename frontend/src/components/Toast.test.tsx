import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toast'

function PushToast() {
  const toast = useToast()
  return <button onClick={() => toast('测试消息')}>发送提示</button>
}

afterEach(() => vi.useRealTimers())

it('clears pending toast timeouts when the provider unmounts', () => {
  vi.useFakeTimers()
  const { unmount } = render(<ToastProvider><PushToast /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: '发送提示' }))
  expect(vi.getTimerCount()).toBe(1)

  unmount()

  expect(vi.getTimerCount()).toBe(0)
})
