import { cacheGet, cacheSet } from './offline-cache'

// Stale-while-revalidate variant. Reads any cached entry and fires the
// `onCached` callback with it immediately (so dropdowns / lists can
// populate without waiting for the network), then continues with the
// normal network-first fetch and resolves with the fresh result. Use
// when the cached value is "good enough to render" and you'd rather
// show something now and refresh in-place than block on the network.
// The onCached callback isn't fired when there's no cache entry.
export async function cachedFetchSwr<T = unknown>(
  url: string,
  options: { cacheKey: string; onCached?: (data: T) => void },
): Promise<CachedFetchResult<T>> {
  if (options.onCached) {
    void cacheGet<T>(options.cacheKey).then(cached => {
      if (cached && options.onCached) options.onCached(cached.data)
    })
  }
  return cachedFetch<T>(url, { cacheKey: options.cacheKey })
}

export interface CachedFetchResult<T> {
  data: T
  fromCache: boolean
  cachedAt?: number
}

// GET wrapper that:
// - tries network first; on success caches the response and returns it
// - on network failure (offline or otherwise) falls back to the cached entry
// - if there's no cached entry and the network fails, throws
//
// Only use for read-only / GET endpoints. Mutations should never be cached.
export async function cachedFetch<T = unknown>(url: string, options?: { cacheKey?: string }): Promise<CachedFetchResult<T>> {
  const key = options?.cacheKey || url
  const isOnline = typeof navigator === 'undefined' || navigator.onLine

  if (isOnline) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as T
      // Cache best-effort; don't await before returning.
      cacheSet(key, data)
      return { data, fromCache: false }
    } catch (err) {
      const cached = await cacheGet<T>(key)
      if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.timestamp }
      throw err
    }
  }

  const cached = await cacheGet<T>(key)
  if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.timestamp }
  throw new Error('Offline and no cached data available')
}
