// IndexedDB-backed store for photos taken/picked while offline. We hold the
// raw Blob until the sync worker can hand it to /api/upload and swap the
// resulting public URL into whatever queued mutation references it. Photos
// are referenced from queued bodies as `idb://photo-{id}` strings.

const DB_NAME = 'formentera-photos'
const DB_VERSION = 1
const STORE = 'photos'

export interface PhotoRecord {
  id: string
  blob: Blob
  mimeType: string
  createdAt: number
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
  return `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const PHOTO_REF_PREFIX = 'idb://'

export function isPhotoRef(s: unknown): s is string {
  return typeof s === 'string' && s.startsWith(`${PHOTO_REF_PREFIX}photo-`)
}

export function refToId(ref: string): string {
  return ref.slice(PHOTO_REF_PREFIX.length)
}

export function idToRef(id: string): string {
  return `${PHOTO_REF_PREFIX}${id}`
}

export async function storePhoto(blob: Blob, mimeType?: string): Promise<string> {
  const db = await openDb()
  const record: PhotoRecord = {
    id: newId(),
    blob,
    mimeType: mimeType || blob.type || 'image/jpeg',
    createdAt: Date.now(),
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).add(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  return record.id
}

export async function getPhoto(id: string): Promise<PhotoRecord | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve((req.result as PhotoRecord | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    /* silent */
  }
}
