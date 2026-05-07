// Silently prefetches a list of URLs so the service worker caches their HTML
// responses for offline use. Calls are concurrency-limited and ignore
// failures — this is best-effort background work.

export async function prefetchForOffline(
  urls: string[],
  opts: { concurrency?: number; signal?: AbortSignal } = {}
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const queue = [...urls]
  async function worker() {
    while (queue.length > 0) {
      if (opts.signal?.aborted) return
      const url = queue.shift()
      if (!url) return
      try {
        await fetch(url, { credentials: 'include', signal: opts.signal })
      } catch {
        // Ignore — best-effort.
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}
