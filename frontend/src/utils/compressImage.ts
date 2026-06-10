/** 上传前在浏览器内压缩照片：缩到 maxDim 内的 JPEG，体积通常降 80%+。
 * 解码失败（如个别浏览器不支持 HEIC）时原样返回，由服务端兜底处理。 */
export async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
      // 已经够小就不重编码，避免无谓的画质损失
      if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
      if (!blob || blob.size >= file.size) return file
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    } finally {
      bmp.close()
    }
  } catch {
    return file
  }
}

/** 文件选择回调通用处理：图片逐张压缩，PDF 原样保留。 */
export async function compressPicked(list: FileList | null): Promise<File[]> {
  return Promise.all(Array.from(list ?? []).map((f) => compressImage(f)))
}
