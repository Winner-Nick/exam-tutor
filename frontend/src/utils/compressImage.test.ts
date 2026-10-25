import { expect, it, vi } from 'vitest'
import { compressImage } from './compressImage'

it('paints a white background before encoding an image as JPEG', async () => {
  const bitmap = { width: 2000, height: 1000, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  const fillRect = vi.fn()
  const drawImage = vi.fn()
  const context = {
    fillStyle: '',
    fillRect,
    drawImage,
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob([new Uint8Array(32)], { type: 'image/jpeg' }))
  })
  const file = new File([new Uint8Array(4096)], 'transparent.png', { type: 'image/png' })

  const result = await compressImage(file, 1000)

  expect(context.fillStyle).toBe('#ffffff')
  expect(fillRect).toHaveBeenCalledWith(0, 0, 1000, 500)
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1000, 500)
  expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[0])
  expect(result.type).toBe('image/jpeg')
  expect(result.name).toBe('transparent.jpg')
  expect(bitmap.close).toHaveBeenCalledOnce()
})
