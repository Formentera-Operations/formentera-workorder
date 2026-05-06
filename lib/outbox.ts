// IndexedDB-backed outbox of pending mutation requests. Each action stores a
// fetch-style payload (url, method, body, headers) plus metadata for the UI
// (description, status, retries, error). The sync worker replays them in order
// and marks them done; the UI subscribes for live pending counts.

const DB_NAME = 'formentera-outbox'
const DB_VERSION = 1
const STORE = 'actions'

export type OutboxStatus = 'pending' | 'syncing' | 'failed'

export interface OutboxAction {
  id: string
  url: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  description: string
  createdAt: number
  status: OutboxStatus
  retries: number
  error?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB not available'))
  }
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function newId(): string {
  return `outbox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── pub/sub so React components stay in sync with the outbox state ──
const listeners = new Set<() => void>()
function notify() { for (const fn of listeners) fn() }
export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function enqueue(input: Omit<OutboxAction, 'id' | 'createdAt' | 'status' | 'retries'>): Promise<OutboxAction> {
  const action: OutboxAction = {
    ...input,
    id: newId(),
    createdAt: Date.now(),
    status: 'pending',
    retries: 0,
  }
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).add(action)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    notify()
  } catch {
    // Without IDB the queue can't persist; surface as a thrown error so the
    // caller can show a user-facing message instead of silently dropping work.
    throw new Error('Could not save your change locally — please try again with a connection.')
  }
  return action
}

export async function getAll(): Promise<OutboxAction[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => {
        const all = (req.result as OutboxAction[]) || []
        all.sort((a, b) => a.createdAt - b.createdAt)
        resolve(all)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function update(id: string, patch: Partial<OutboxAction>): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const getReq = store.get(id)
      getReq.onsuccess = () => {
        const existing = getReq.result as OutboxAction | undefined
        if (!existing) { resolve(); return }
        const next = { ...existing, ...patch }
        const putReq = store.put(next)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
      }
      getReq.onerror = () => reject(getReq.error)
    })
    notify()
  } catch {
    // Silent — sync worker will retry.
  }
}

export async function remove(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    notify()
  } catch {
    // Silent.
  }
}
