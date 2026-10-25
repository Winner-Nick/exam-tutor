import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

it('uses an external reconnect script and no inline event handler', () => {
  const html = readFileSync('public/offline.html', 'utf8')
  const document = new DOMParser().parseFromString(html, 'text/html')

  expect(document.querySelector('script')?.getAttribute('src')).toBe('/offline.js')
  expect(document.querySelector('[onclick]')).toBeNull()
  expect(document.getElementById('reconnect')).not.toBeNull()
})

it('reloads the current location when reconnect is activated', () => {
  const source = readFileSync('public/offline.js', 'utf8')
  const reload = vi.fn()
  let reconnect: (() => void) | undefined
  const button = {
    addEventListener: vi.fn((_event: string, listener: () => void) => { reconnect = listener }),
  }
  runInNewContext(source, {
    document: { getElementById: () => button },
    window: { location: { reload } },
  })

  reconnect?.()
  expect(button.addEventListener).toHaveBeenCalledWith('click', expect.any(Function))
  expect(reload).toHaveBeenCalledOnce()
})
