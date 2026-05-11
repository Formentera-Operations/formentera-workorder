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

// Photo-store mirror — must match lib/offline-photos.ts.
const PHOTOS_DB = 'formentera-photos'
const PHOTOS_DB_VERSION = 1
const PHOTOS_STORE = 'photos'
const PHOTO_REF_PREFIX = 'idb://'

interface PhotoRecord {
  id: string
  blob: Blob
  mimeType: string
  createdAt: number
}

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
  meta?: {
    duplicates?: Array<{ id: number }>
    conflict?: { ticketId: number; current: Record<string, unknown> }
  }
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

// ── Photo helpers (open separate DB) ──────────────────────────────
function openPhotosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTOS_DB, PHOTOS_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getPhotoRecord(db: IDBDatabase, id: string): Promise<PhotoRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readonly')
    const req = tx.objectStore(PHOTOS_STORE).get(id)
    req.onsuccess = () => resolve((req.result as PhotoRecord | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

function deletePhotoRecord(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite')
    const req = tx.objectStore(PHOTOS_STORE).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function isPhotoRef(s: unknown): s is string {
  return typeof s === 'string' && s.startsWith(`${PHOTO_REF_PREFIX}photo-`)
}

function refToId(ref: string): string { return ref.slice(PHOTO_REF_PREFIX.length) }

function walkStrings(v: unknown, fn: (s: string) => void): void {
  if (typeof v === 'string') fn(v)
  else if (Array.isArray(v)) for (const item of v) walkStrings(item, fn)
  else if (v && typeof v === 'object') for (const item of Object.values(v as Record<string, unknown>)) walkStrings(item, fn)
}

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

function stripEmptyArrayStrings<T>(v: T): T {
  if (Array.isArray(v)) return v.filter(x => x !== '').map(x => stripEmptyArrayStrings(x)) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = stripEmptyArrayStrings(val)
    return out as T
  }
  return v
}

async function resolvePhotoRefs(
  outboxDb: IDBDatabase,
  action: OutboxAction
): Promise<{ body: unknown } | { error: string }> {
  let body = action.body
  if (body === undefined) return { body }
  const refs = new Set<string>()
  walkStrings(body, s => { if (isPhotoRef(s)) refs.add(s) })
  if (refs.size === 0) return { body }
  const photosDb = await openPhotosDb()
  for (const ref of refs) {
    const id = refToId(ref)
    const rec = await getPhotoRecord(photosDb, id)
    if (!rec) {
      body = mapStrings(body, s => (s === ref ? '' : s))
      body = stripEmptyArrayStrings(body)
      continue
    }
    try {
      const fd = new FormData()
      const ext = rec.mimeType === 'image/jpeg' ? 'jpg' : (rec.mimeType.split('/')[1] || 'jpg')
      fd.append('file', new File([rec.blob], `${id}.${ext}`, { type: rec.mimeType || 'image/jpeg' }))
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) return { error: `Photo upload failed (${res.status})` }
      const { url } = (await res.json()) as { url?: string }
      if (typeof url !== 'string') return { error: 'Photo upload returned no URL' }
      body = mapStrings(body, s => (s === ref ? url : s))
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Photo upload network error' }
    }
    await patchAction(outboxDb, action.id, { body })
    await deletePhotoRecord(photosDb, id)
  }
  return { body }
}

async function replayOutboxInner(): Promise<void> {
  const db = await openDb()
  const pending = await getAllPending(db)
  for (const action of pending) {
    try {
      // Resolve any IDB-stored photos referenced by this action first; the
      // helper persists swapped URLs back to the outbox so a retry won't
      // re-upload anything that already made it.
      const resolved = await resolvePhotoRefs(db, action)
      if ('error' in resolved) {
        // Photo upload couldn't complete — leave action pending; next sync retries.
        continue
      }
      const replayBody = resolved.body
      const res = await fetch(action.url, {
        method: action.method,
        headers: { 'Content-Type': 'application/json', ...(action.headers || {}) },
        body: replayBody !== undefined ? JSON.stringify(replayBody) : undefined,
      })
      if (res.ok) {
        await deleteAction(db, action.id)
        continue
      }
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
      let msg = `${res.status}`
      let meta: OutboxAction['meta']
      try {
        const data = (await res.json()) as {
          error?: string
          duplicates?: Array<{ id: number }>
          current?: Record<string, unknown>
        }
        if (typeof data?.error === 'string') msg = data.error
        if (res.status === 409 && Array.isArray(data?.duplicates)) {
          meta = { duplicates: data.duplicates }
          if (msg === '409') msg = 'Looks like a duplicate'
        }
        if (res.status === 412 && data?.current) {
          // /api/tickets/{id} carries the id in the URL; /api/dispatch and
          // /api/repairs carry it on `current.id` since the URL is generic.
          const m = /\/api\/tickets\/(\d+)/.exec(action.url)
          const ticketId = m
            ? parseInt(m[1], 10)
            : typeof data.current.id === 'number'
            ? data.current.id
            : Number(data.current.id)
          if (!Number.isNaN(ticketId)) {
            meta = { conflict: { ticketId, current: data.current } }
            if (msg === '412') msg = 'Ticket was changed by someone else'
          }
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

// Wraps replayOutboxInner in two guards:
//   1. Skip entirely if any window/tab is open — that page already runs its
//      own flushOutbox and would race with us, producing duplicates.
//   2. Web Lock so two SW lifecycles or a SW + a tab can't both fire at once.
async function replayOutbox(): Promise<void> {
  const clients = await sw.clients.matchAll({ type: 'window' })
  if (clients.length > 0) return
  const locks = (self as unknown as { navigator?: { locks?: { request?: (name: string, opts: object, fn: () => Promise<void>) => Promise<void> } } }).navigator?.locks
  if (locks?.request) {
    await locks.request('outbox-flush', { mode: 'exclusive' }, () => replayOutboxInner())
  } else {
    await replayOutboxInner()
  }
}

interface SyncEvt extends ExtendableEvent { tag: string }
sw.addEventListener('sync', ((event: SyncEvt) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayOutbox())
  }
}) as EventListener)

export {}
