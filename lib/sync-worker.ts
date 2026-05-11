import { getAll, remove, update, type OutboxAction } from './outbox'
import { deletePhoto, getPhoto, isPhotoRef, refToId } from './offline-photos'

const MAX_RETRIES = 5

let flushing = false

// Walk an unknown JSON-shaped value, calling `fn` on every string leaf.
function walkStrings(v: unknown, fn: (s: string) => void): void {
  if (typeof v === 'string') fn(v)
  else if (Array.isArray(v)) for (const item of v) walkStrings(item, fn)
  else if (v && typeof v === 'object') for (const item of Object.values(v as Record<string, unknown>)) walkStrings(item, fn)
}

// Return a structurally-identical value with every string replaced via `fn`.
function mapStrings<T>(v: T, fn: (s: string) => string): T {
  if (typeof v === 'string') return fn(v) as unknown as T
  if (Array.isArray(v)) return v.map(item => mapStrings(item, fn)) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = mapStrings(val, fn)
    return out as T
  }
  return v
}

// Walk the action body for `idb://photo-{id}` refs; upload each blob to
// /api/upload, persist the swapped body back to the outbox after each
// success (so a retry doesn't re-upload), then drop the IDB blob.
async function resolvePhotoRefs(action: OutboxAction): Promise<{ body: unknown } | { error: string }> {
  let body = action.body
  if (body === undefined) return { body }

  const refs = new Set<string>()
  walkStrings(body, s => { if (isPhotoRef(s)) refs.add(s) })
  if (refs.size === 0) return { body }

  for (const ref of refs) {
    const id = refToId(ref)
    const rec = await getPhoto(id)
    if (!rec) {
      // Blob is gone — likely already uploaded on a prior retry but the
      // body wasn't persisted, or the user wiped storage. Either way the
      // ref is dead; drop it from the body so the request can proceed.
      body = mapStrings(body, s => (s === ref ? '' : s))
      // Strip empty strings out of arrays (Issue_Photos shouldn't carry blanks).
      body = stripEmptyArrayStrings(body)
      continue
    }
    try {
      const fd = new FormData()
      const ext = rec.mimeType === 'image/jpeg' ? 'jpg' : rec.mimeType.split('/')[1] || 'jpg'
      fd.append('file', new File([rec.blob], `${id}.${ext}`, { type: rec.mimeType || 'image/jpeg' }))
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) return { error: `Photo upload failed (${res.status})` }
      const { url } = (await res.json()) as { url?: string }
      if (typeof url !== 'string') return { error: 'Photo upload returned no URL' }
      body = mapStrings(body, s => (s === ref ? url : s))
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Photo upload network error' }
    }
    // Persist the swapped body so a later retry only handles whatever's left.
    await update(action.id, { body })
    await deletePhoto(id)
  }

  return { body }
}

function stripEmptyArrayStrings<T>(v: T): T {
  if (Array.isArray(v)) return v.filter(x => x !== '').map(x => stripEmptyArrayStrings(x)) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = stripEmptyArrayStrings(val)
    return out as T
  }
  return v
}

async function replayOne(action: OutboxAction): Promise<
  | { ok: true }
  | { ok: false; status?: number; message: string; permanent: boolean; meta?: OutboxAction['meta'] }
> {
  // Step 1: upload any locally-stored photos referenced from the body and
  // swap in real URLs. Network-style failures here are transient.
  const resolved = await resolvePhotoRefs(action)
  if ('error' in resolved) {
    return { ok: false, message: resolved.error, permanent: false }
  }
  const body = resolved.body

  try {
    const res = await fetch(action.url, {
      method: action.method,
      headers: { 'Content-Type': 'application/json', ...(action.headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (res.ok) return { ok: true }
    // 4xx (except 408/429) is the server saying "this won't ever succeed" —
    // mark failed and stop retrying so the user can address it.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
    let msg = `${res.status}`
    let meta: OutboxAction['meta']
    try {
      const data = await res.json()
      if (data && typeof data === 'object') {
        const errVal = (data as { error?: unknown }).error
        if (typeof errVal === 'string') msg = errVal
        // POST /api/tickets returns 409 with a `duplicates` payload — keep it
        // around so the failed-sync UI can show "looks like a duplicate of #N".
        if (res.status === 409 && Array.isArray((data as { duplicates?: unknown }).duplicates)) {
          const dupes = (data as { duplicates: NonNullable<OutboxAction['meta']>['duplicates'] }).duplicates
          meta = { duplicates: dupes }
          if (!msg || msg === '409') msg = 'Looks like a duplicate'
        }
        // 412 with a `current` row means the parent ticket changed since we
        // loaded it. PATCH /api/tickets/{id} carries the id in the URL;
        // POST /api/dispatch and POST /api/repairs carry it on the response
        // (`current.id`) since the URL doesn't include the ticket id. Stash
        // either way so the failed-sync modal can offer View latest / Apply
        // anyway / Discard.
        if (res.status === 412 && (data as { current?: unknown }).current && typeof (data as { current?: unknown }).current === 'object') {
          const current = (data as { current: Record<string, unknown> }).current
          const urlIdMatch = /\/api\/tickets\/(\d+)/.exec(action.url)
          const ticketId = urlIdMatch
            ? parseInt(urlIdMatch[1], 10)
            : typeof current.id === 'number'
            ? current.id
            : Number(current.id)
          if (!Number.isNaN(ticketId)) {
            meta = { conflict: { ticketId, current } }
            if (!msg || msg === '412') msg = 'Ticket was changed by someone else'
          }
        }
      }
    } catch { /* response wasn't JSON */ }
    return { ok: false, status: res.status, message: msg, permanent, meta }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Network error',
      permanent: false,
    }
  }
}

export async function flushOutbox(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { synced: 0, failed: 0 }
  flushing = true
  // navigator.locks serializes across tabs (and the service worker if it's
  // also running). Without it, two tabs can both pick up the same queued
  // POST and fire it concurrently — the cause of the user-reported triple
  // ticket. Falls through to no lock when the API isn't available.
  const runWithLock = (typeof navigator !== 'undefined' && navigator.locks?.request)
    ? <T,>(fn: () => Promise<T>) => navigator.locks.request('outbox-flush', { mode: 'exclusive' }, fn)
    : <T,>(fn: () => Promise<T>) => fn()
  let synced = 0
  let failed = 0
  try {
    await runWithLock(async () => {
      // Under the lock, no other context can be mid-flight, so any action
      // still in 'syncing' is from a crashed previous attempt (page closed
      // mid-fetch, etc.). Reset those to 'pending' so they get retried —
      // server-side dedup catches anything that already landed.
      const all = await getAll()
      for (const a of all) {
        if (a.status === 'syncing') {
          await update(a.id, { status: 'pending' })
        }
      }
      const pending = (await getAll()).filter(a => a.status === 'pending')
      for (const action of pending) {
        await update(action.id, { status: 'syncing' })
        const result = await replayOne(action)
        if (result.ok) {
          await remove(action.id)
          synced++
        } else if (result.permanent || action.retries + 1 >= MAX_RETRIES) {
          await update(action.id, {
            status: 'failed',
            error: result.message,
            retries: action.retries + 1,
            meta: result.meta,
          })
          failed++
        } else {
          // Transient failure — bump retry count and leave it pending for the
          // next flush cycle.
          await update(action.id, {
            status: 'pending',
            error: result.message,
            retries: action.retries + 1,
            meta: result.meta,
          })
          failed++
          // If the network just went down, stop the loop early.
          if (typeof navigator !== 'undefined' && !navigator.onLine) break
        }
      }
    })
  } finally {
    flushing = false
  }
  return { synced, failed }
}

let started = false
// Wires the auto-flush triggers: on `online` event, on app load, and on a
// modest poll interval as a safety net (some networks transition state
// without firing the online event).
export function startSyncWorker(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  const onOnline = () => { void flushOutbox() }
  window.addEventListener('online', onOnline)
  // Initial attempt + periodic retry while online.
  void flushOutbox()
  const interval = window.setInterval(() => { void flushOutbox() }, 30000)
  return () => {
    started = false
    window.removeEventListener('online', onOnline)
    window.clearInterval(interval)
  }
}
