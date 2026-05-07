/// <reference lib="webworker" />
// Custom snippet appended by @ducanh2912/next-pwa to the generated service
// worker. Two responsibilities:
//   1. SKIP_WAITING handler — lets the client activate a newly installed
//      worker via the "Update ready — tap to reload" banner.
//   2. Background Sync — reads the same IndexedDB outbox the page uses and
//      replays queued requests when the OS wakes the SW with a `sync` event,
//      even if the app tab is closed.
const sw = self as unknown as ServiceWorkerGlobalScope

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null
  if (data && data.type === 'SKIP_WAITING') {
    sw.skipWaiting()
  }
})

// ── Background Sync ─────────────────────────────────────────────────
// Must match lib/outbox.ts on the page side.
const DB_NAME = 'formentera-outbox'
const DB_VERSION = 1
const STORE = 'actions'
const SYNC_TAG = 'outbox-sync'
const MAX_RETRIES = 5

interface OutboxAction {
  id: string
  url: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  description: string
  createdAt: number
  status: 'pending' | 'syncing' | 'failed'
  retries: number
  error?: string
  meta?: { duplicates?: Array<{ id: number }> }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAllPending(db: IDBDatabase): Promise<OutboxAction[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result as OutboxAction[]) || []
      const pending = all.filter(a => a.status !== 'failed').sort((a, b) => a.createdAt - b.createdAt)
      resolve(pending)
    }
    req.onerror = () => reject(req.error)
  })
}

function patchAction(db: IDBDatabase, id: string, patch: Partial<OutboxAction>): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const existing = getReq.result as OutboxAction | undefined
      if (!existing) { resolve(); return }
      const putReq = store.put({ ...existing, ...patch })
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

function deleteAction(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function replayOutbox(): Promise<void> {
  const db = await openDb()
  const pending = await getAllPending(db)
  for (const action of pending) {
    try {
      const res = await fetch(action.url, {
        method: action.method,
        headers: { 'Content-Type': 'application/json', ...(action.headers || {}) },
        body: action.body !== undefined ? JSON.stringify(action.body) : undefined,
      })
      if (res.ok) {
        await deleteAction(db, action.id)
        continue
      }
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
      let msg = `${res.status}`
      let meta: OutboxAction['meta']
      try {
        const data = (await res.json()) as { error?: string; duplicates?: Array<{ id: number }> }
        if (typeof data?.error === 'string') msg = data.error
        if (res.status === 409 && Array.isArray(data?.duplicates)) {
          meta = { duplicates: data.duplicates }
          if (msg === '409') msg = 'Looks like a duplicate'
        }
      } catch { /* not JSON */ }
      if (permanent || action.retries + 1 >= MAX_RETRIES) {
        await patchAction(db, action.id, { status: 'failed', error: msg, retries: action.retries + 1, meta })
      } else {
        await patchAction(db, action.id, { status: 'pending', error: msg, retries: action.retries + 1, meta })
      }
    } catch {
      // Network error — leave action in place for the next sync.
    }
  }
}

interface SyncEvt extends ExtendableEvent { tag: string }
sw.addEventListener('sync', ((event: SyncEvt) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayOutbox())
  }
}) as EventListener)

export {}
