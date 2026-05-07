// Asks the browser to mark our origin's storage as persistent so the OS
// won't auto-evict the IDB cache, photo blobs, or outbox under storage
// pressure. iOS PWAs installed to the home screen already get this
// implicitly; the call still helps anyone using the app in plain Safari
// or on first install. Always best-effort — never throws.

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return false
  }
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const already = await navigator.storage.persisted()
      if (already) return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
