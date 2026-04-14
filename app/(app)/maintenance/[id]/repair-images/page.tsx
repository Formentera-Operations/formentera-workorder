'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, ImageIcon } from 'lucide-react'

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
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt={`Repair photo ${i + 1}`} className="w-full rounded-xl object-cover" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
