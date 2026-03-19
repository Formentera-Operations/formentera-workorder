import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    const db = supabaseAdmin()
    const { error } = await db.from('comments').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Comment delete error:', error)
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()

    const { data, error } = await db
      .from('comments')
      .insert([{
        ticket_id: body.ticket_id,
        author_name: body.author_name,
        author_email: body.author_email || null,
        body: body.body,
        parent_id: body.parent_id || null,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Comment post error:', error)
    return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 })
  }
}
