import { getAll, remove, update, type OutboxAction } from './outbox'

const MAX_RETRIES = 5

let flushing = false

async function replayOne(action: OutboxAction): Promise<
  | { ok: true }
  | { ok: false; status?: number; message: string; permanent: boolean; meta?: OutboxAction['meta'] }
> {
  try {
    const res = await fetch(action.url, {
      method: action.method,
      headers: { 'Content-Type': 'application/json', ...(action.headers || {}) },
      body: action.body !== undefined ? JSON.stringify(action.body) : undefined,
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
  let synced = 0
  let failed = 0
  try {
    const pending = (await getAll()).filter(a => a.status !== 'failed')
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
