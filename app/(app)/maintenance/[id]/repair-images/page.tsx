'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, ImageIcon, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { usePhotoSrc } from '@/lib/use-photo-src'

function ZoomablePhoto({ url, alt }: { url: string; alt: string }) {
  const [scale, setScale] = useState(1)
  const resolvedUrl = usePhotoSrc(url)
  return (
    <TransformWrapper
      initialScale={1}
      minScale={1}
      maxScale={5}
      doubleClick={{ mode: 'toggle', step: 2 }}
      wheel={{ step: 0.2, activationKeys: ['Control', 'Meta'] }}
      panning={{ disabled: scale <= 1 }}
      onTransform={(_ref, state) => setScale(state.scale)}
    >
      {({ zoomIn, zoomOut, resetTransform }) => (
        <div className="relative bg-gray-100 rounded-xl overflow-hidden">
          <TransformComponent wrapperClass="!w-full" contentClass="!w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolvedUrl} alt={alt} className="w-full max-h-[70vh] object-contain select-none" draggable={false} />
          </TransformComponent>
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full p-1">
            <button
              type="button"
              onClick={() => zoomOut()}
              className="w-8 h-8 flex items-center justify-center text-white rounded-full hover:bg-white/15 active:bg-white/25 transition-colors"
              aria-label="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              onClick={() => resetTransform()}
              className="w-8 h-8 flex items-center justify-center text-white rounded-full hover:bg-white/15 active:bg-white/25 transition-colors"
              aria-label="Reset zoom"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={() => zoomIn()}
              className="w-8 h-8 flex items-center justify-center text-white rounded-full hover:bg-white/15 active:bg-white/25 transition-colors"
              aria-label="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </div>
      )}
    </TransformWrapper>
  )
}

export default function RepairImagesPage() {
  const router = useRouter()
  const { id } = useParams()
  const [photos, setPhotos] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/tickets/${id}`)
      .then(r => r.json())
      .then(data => {
        const repairs = data.repairs || []
        const imgs = repairs.flatMap((r: Record<string, unknown>) => r.repair_images || []) as string[]
        setPhotos(imgs)
        setLoading(false)
      })
  }, [id])

  return (
    <div className="flex flex-col min-h-screen">
      <div className="page-header">
        <button onClick={() => router.back()} className="p-1 -ml-1">
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <h1 className="page-title">Repair Images</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-sm text-gray-400 py-8">Loading…</div>
        ) : photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <ImageIcon size={48} className="text-gray-300" />
            <p className="text-sm text-gray-400">No repair photos attached yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {photos.map((url, i) => (
              <ZoomablePhoto key={i} url={url} alt={`Repair photo ${i + 1}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
