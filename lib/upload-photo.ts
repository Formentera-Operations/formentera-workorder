// Single entry point the forms call when a user picks a photo. Online: hit
// /api/upload as before and return the public URL. Offline (or upload
// failed at the network layer): compress, drop the Blob in IDB, and return
// an `idb://photo-{id}` placeholder. The sync worker walks queued mutation
// bodies for those refs, uploads them, and swaps in the real URL before
// replaying the request.

import { compressImage } from './compress-image'
import { storePhoto, idToRef } from './offline-photos'

export async function uploadPhoto(file: File): Promise<string> {
  // Compress before either path so the IDB record stays small AND the
  // online upload is faster on cellular.
  const compressed = await compressImage(file, { maxDim: 1600, quality: 0.82 })
  const ext = compressed.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg')
  const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${ext}`
  const uploadFile = new File([compressed], name, { type: compressed.type || file.type })

  const isOnline = typeof navigator === 'undefined' || navigator.onLine
  if (isOnline) {
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (res.ok) {
        const { url } = (await res.json()) as { url?: string }
        if (typeof url === 'string') return url
      }
      // Non-OK response — fall through to local store; sync worker will retry.
    } catch {
      /* network error — fall through */
    }
  }

  const id = await storePhoto(uploadFile, uploadFile.type)
  return idToRef(id)
}
