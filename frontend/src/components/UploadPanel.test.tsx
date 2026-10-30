import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileDropzone, SelectedFileList, UploadProgress } from './UploadPanel'

afterEach(() => vi.unstubAllGlobals())

it('accepts dropped files and respects the remaining limit', () => {
  const onFiles = vi.fn()
  const { rerender } = render(<FileDropzone onFiles={onFiles} remaining={2} limit={12} />)
  const file = new File(['pdf'], 'answer.pdf', { type: 'application/pdf' })
  fireEvent.drop(screen.getByRole('button', { name: '上传照片或 PDF，选择文件' }), { dataTransfer: { files: [file] } })
  expect(onFiles).toHaveBeenCalledOnce()
  expect(onFiles.mock.calls[0][0][0]).toBe(file)

  onFiles.mockClear()
  rerender(<FileDropzone onFiles={onFiles} remaining={0} limit={12} />)
  const disabled = screen.getByRole('button', { name: '上传照片或 PDF，选择文件' })
  expect(disabled).toBeDisabled()
  fireEvent.drop(disabled, { dataTransfer: { files: [file] } })
  expect(onFiles).not.toHaveBeenCalled()
})

it('revokes image previews and exposes file removal', () => {
  const create = vi.fn(() => 'blob:preview')
  const revoke = vi.fn()
  const OriginalURL = URL
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL() { return create() }
    static revokeObjectURL(url: string) { revoke(url) }
  })
  const onRemove = vi.fn()
  const file = new File(['image'], 'answer.png', { type: 'image/png' })
  const { unmount } = render(<SelectedFileList files={[file]} onRemove={onRemove} />)
  expect(document.querySelector('img')).toHaveAttribute('src', 'blob:preview')

  fireEvent.click(screen.getByRole('button', { name: '移除 answer.png' }))
  expect(onRemove).toHaveBeenCalledWith(0)
  unmount()
  expect(create).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledWith('blob:preview')
})

it('shows upload progress and cancels through the same action', () => {
  const onCancel = vi.fn()
  render(<UploadProgress percent={42} onCancel={onCancel} />)
  expect(screen.getByText('正在上传文件 42%')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42')
  fireEvent.click(screen.getByRole('button', { name: '取消上传' }))
  expect(onCancel).toHaveBeenCalledOnce()
})
