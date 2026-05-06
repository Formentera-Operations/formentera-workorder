// Tiny IndexedDB-backed cache for read-only API responses.
// Keys are arbitrary strings (e.g. the request URL); values are JSON-serializable.

const DB_NAME = 'formentera-cache'
const DB_VERSION = 1
const STORE = 'responses'

export interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
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
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
  return dbPromise
}

export async function cacheGet<T = unknown>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as CacheEntry<T>) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function cacheSet<T = unknown>(key: string, data: T): Promise<void> {
  try {
    const db = await openDb()
    const entry: CacheEntry<T> = { data, timestamp: Date.now() }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).put(entry, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Silent — cache is best-effort.
  }
}

export async function cacheClear(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Silent.
  }
}
