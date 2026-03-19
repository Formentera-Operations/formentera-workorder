'use client'
import { useState } from 'react'
import { formatDate } from '@/lib/utils'
import { CornerDownRight, Trash2 } from 'lucide-react'

type Comment = {
  id: number
  body: string
  author_name: string
  created_at: string
  parent_id: number | null
}

interface CommentsSectionProps {
  comments: Comment[]
  ticketId: string | string[]
  userName: string
  userEmail: string
  onRefresh: () => void
}

export default function CommentsSection({ comments, ticketId, userName, userEmail, onRefresh }: CommentsSectionProps) {
  const [newComment, setNewComment] = useState('')
  const [replyToId, setReplyToId] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [posting, setPosting] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const topLevel = comments.filter(c => !c.parent_id)
  const replies = (parentId: number) => comments.filter(c => c.parent_id === parentId)

  async function post(body: string, parentId: number | null) {
    if (!body.trim()) return
    setPosting(true)
    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          body,
          author_name: userName,
          author_email: userEmail,
          parent_id: parentId,
        }),
      })
      if (parentId) {
        setReplyText('')
        setReplyToId(null)
      } else {
        setNewComment('')
      }
      onRefresh()
    } finally {
      setPosting(false)
    }
  }

  async function deleteComment(id: number) {
    await fetch('/api/comments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleteId(null)
    onRefresh()
  }

  function CommentBubble({ c, indented = false }: { c: Comment; indented?: boolean }) {
    const isOwner = c.author_name === userName
    return (
      <div className={`bg-gray-50 rounded-lg p-3 ${indented ? 'flex-1' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-gray-500">{c.author_name} · {formatDate(c.created_at)}</p>
          {isOwner && (
            <button
              type="button"
              onClick={() => setDeleteId(c.id)}
              className="text-gray-400 hover:text-red-500 flex-shrink-0"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <p className="text-sm text-gray-800 mt-1">{c.body}</p>
        {!indented && (
          <button
            className="text-xs text-[#1B2E6B] font-medium mt-2"
            onClick={() => setReplyToId(replyToId === c.id ? null : c.id)}
          >
            {replyToId === c.id ? 'Cancel' : 'Reply'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="border-t border-gray-200 pt-4">
      <h3 className="text-lg font-bold text-gray-900 mb-3">Comments</h3>

      <div className="space-y-4">
        {topLevel.map(c => (
          <div key={c.id}>
            <CommentBubble c={c} />

            {/* Replies */}
            {replies(c.id).map(r => (
              <div key={r.id} className="flex gap-2 mt-2 ml-4">
                <CornerDownRight size={14} className="text-gray-300 mt-1 flex-shrink-0" />
                <CommentBubble c={r} indented />
              </div>
            ))}

            {/* Inline reply box */}
            {replyToId === c.id && (
              <div className="ml-4 mt-2 flex gap-2">
                <CornerDownRight size={14} className="text-gray-300 mt-3 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <textarea
                    className="form-textarea text-sm"
                    placeholder={`Reply to ${c.author_name}…`}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    rows={2}
                  />
                  <button
                    className="btn-submit py-2 text-sm"
                    onClick={() => post(replyText, c.id)}
                    disabled={posting || !replyText.trim()}
                  >
                    {posting ? 'Posting…' : 'Post Reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New top-level comment */}
      <div className="mt-4 space-y-2">
        <textarea
          className="form-textarea"
          placeholder="Write something..."
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
        />
        <button
          className="btn-submit"
          onClick={() => post(newComment, null)}
          disabled={posting || !newComment.trim()}
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {/* Delete confirmation modal */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3">
            <h3 className="text-lg font-bold text-gray-900">Delete Comment?</h3>
            <p className="text-sm text-gray-500">This action cannot be undone.</p>
            <button
              type="button"
              className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold"
              onClick={() => deleteComment(deleteId)}
            >
              Delete
            </button>
            <button
              type="button"
              className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
