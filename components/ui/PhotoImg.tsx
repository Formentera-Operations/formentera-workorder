'use client'
import type { ImgHTMLAttributes } from 'react'
import { usePhotoSrc } from '@/lib/use-photo-src'

interface PhotoImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  url: string
}

// Drop-in <img> replacement that knows how to surface the `idb://photo-{id}`
// refs returned by uploadPhoto when offline. Real https:// URLs pass through
// unchanged.
export default function PhotoImg({ url, alt = '', ...rest }: PhotoImgProps) {
  const src = usePhotoSrc(url)
  if (!src) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} {...rest} />
}
