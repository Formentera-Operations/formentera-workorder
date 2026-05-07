// Resolve a photo URL for display. Real https:// URLs pass through; the
// `idb://photo-{id}` refs we hand out for offline uploads get pulled from
// IndexedDB and surfaced as object URLs (which we revoke on unmount to
// avoid leaks).

import { useEffect, useState } from 'react'
import { getPhoto, isPhotoRef, refToId } from './offline-photos'

export function usePhotoSrc(url: string | undefined | null): string {
  const [src, setSrc] = useState<string>(() => (url && !isPhotoRef(url) ? url : ''))

  useEffect(() => {
    if (!url) { setSrc(''); return }
    if (!isPhotoRef(url)) { setSrc(url); return }

    let cancelled = false
    let objectUrl: string | null = null
    const id = refToId(url)
    getPhoto(id).then(rec => {
      if (cancelled) return
      if (!rec) { setSrc(''); return }
      objectUrl = URL.createObjectURL(rec.blob)
      setSrc(objectUrl)
    }).catch(() => { if (!cancelled) setSrc('') })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return src
}
