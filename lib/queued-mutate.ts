import { enqueue } from './outbox'
import { flushOutbox } from './sync-worker'

export interface QueuedMutateResult {
  ok: boolean
  queued: boolean
  status: number
  data?: unknown
  error?: string
}

export interface QueuedMutateOptions {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  // Human-readable label used by the outbox UI (e.g. "Close ticket #495").
  description: string
}

// Mutation wrapper that:
//   - fires the request immediately when online and returns the real result
//   - on offline (or network failure) writes the request to the outbox so the
//     sync worker can replay it later, returning a synthetic "queued" result
// Use only for write endpoints whose effect is idempotent enough to safely
// retry. Photo uploads (multipart) shouldn't go through this path.
export async function queuedMutate(url: string, options: QueuedMutateOptions): Promise<QueuedMutateResult> {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine
  if (isOnline) {
    try {
      const res = await fetch(url, {
        method: options.method,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      })
      let data: unknown
      try { data = await res.json() } catch { data = null }
      if (res.ok) return { ok: true, queued: false, status: res.status, data }
      const error =
        data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `HTTP ${res.status}`
      return { ok: false, queued: false, status: res.status, error }
    } catch (err) {
      // Network failure — fall through to queueing so the user's work isn't
      // lost if connectivity drops mid-request.
      const message = err instanceof Error ? err.message : 'Network error'
      try {
        await enqueue({ url, method: options.method, body: options.body, headers: options.headers, description: options.description })
        // Try one more flush soon in case the network blip is recovered.
        setTimeout(() => { void flushOutbox() }, 1000)
        return { ok: true, queued: true, status: 202 }
      } catch (queueErr) {
        return {
          ok: false,
          queued: false,
          status: 0,
          error: queueErr instanceof Error ? queueErr.message : message,
        }
      }
    }
  }
  try {
    await enqueue({ url, method: options.method, body: options.body, headers: options.headers, description: options.description })
    return { ok: true, queued: true, status: 202 }
  } catch (err) {
    return {
      ok: false,
      queued: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Could not save change locally',
    }
  }
}
