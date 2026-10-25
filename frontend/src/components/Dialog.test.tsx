import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

function backdrop() {
  return screen.getByRole('dialog').parentElement!
}

describe('Dialog closing', () => {
  it('allows Escape, backdrop, and the close button by default', () => {
    const onClose = vi.fn()
    render(<Dialog title="测试" onClose={onClose}><button>内部按钮</button></Dialog>)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(backdrop())
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }))

    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('blocks every close path and disables the button with preventClose', () => {
    const onClose = vi.fn()
    render(<Dialog title="测试" onClose={onClose} preventClose><button>内部按钮</button></Dialog>)

    expect(screen.getByRole('button', { name: '关闭对话框' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(backdrop())

    expect(onClose).not.toHaveBeenCalled()
  })

  it('also blocks Escape and backdrop when the close button is hidden', () => {
    const onClose = vi.fn()
    render(<Dialog title="测试" onClose={onClose} hideClose><button>内部按钮</button></Dialog>)

    expect(screen.queryByRole('button', { name: '关闭对话框' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(backdrop())

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Dialog focus containment', () => {
  it('brings Tab back into the dialog when focus is outside', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement
    })
    render(<><button>外部按钮</button><Dialog title="测试" onClose={() => undefined}><button>最后一个按钮</button></Dialog></>)
    const outside = screen.getByRole('button', { name: '外部按钮' })
    outside.focus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '关闭对话框' })).toHaveFocus()

    outside.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: '最后一个按钮' })).toHaveFocus()
  })

  it('focuses the panel on Tab when no focusable item is visible', () => {
    render(<><button>外部按钮</button><Dialog title="测试" onClose={() => undefined} hideClose><span>只有文本</span></Dialog></>)
    screen.getByRole('button', { name: '外部按钮' }).focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})
