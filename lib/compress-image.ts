// Client-side image downscaling. iPhone photos arrive at 12MP / ~3–5MB; with
// no compression a foreman's offline ticket could blow past IDB quota and
// waste cellular when the queue eventually drains. We resize to ~1600px on
// the long side and re-encode as JPEG, which is plenty for diagnosing a leak
// or a damaged fitting.

interface CompressOptions {
  maxDim?: number
  quality?: number
  mimeType?: string
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<Blob> {
  const maxDim = opts.maxDim ?? 1600
  const quality = opts.quality ?? 0.82
  const mimeType = opts.mimeType ?? 'image/jpeg'

  if (typeof document === 'undefined') return file
  if (!file.type.startsWith('image/')) return file

  const bitmap = await loadBitmap(file).catch(() => null)
  if (!bitmap) return file

  const { width, height } = bitmap
  const longest = Math.max(width, height)
  const scale = longest > maxDim ? maxDim / longest : 1
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(b => resolve(b), mimeType, quality)
  )
  return blob || file
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is the fast path on modern browsers; fall back to a
  // plain <img> element when it isn't available (older Safari).
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
