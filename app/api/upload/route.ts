import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'ticket-images'
// Legacy bucket still receives DELETE calls for photos uploaded before the
// ticket-images cutover. New uploads always go to BUCKET.
const LEGACY_BUCKETS = ['work-orders']

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const path = `issue-photos/${fileName}`

    const db = supabaseAdmin()
    const { error } = await db.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type })

    if (error) throw error

    const { data: { publicUrl } } = db.storage
      .from(BUCKET)
      .getPublicUrl(path)

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 })

    // Match against the current bucket first, then any legacy bucket so old
    // photos can still be cleaned up.
    const candidates = [BUCKET, ...LEGACY_BUCKETS]
    let matched: { bucket: string; path: string } | null = null
    for (const bucket of candidates) {
      const marker = `/${bucket}/`
      const idx = url.indexOf(marker)
      if (idx !== -1) {
        matched = { bucket, path: url.slice(idx + marker.length) }
        break
      }
    }
    if (!matched) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })

    const db = supabaseAdmin()
    const { error } = await db.storage.from(matched.bucket).remove([matched.path])
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
