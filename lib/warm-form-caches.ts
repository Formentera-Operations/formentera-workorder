// Pre-fetches the new-ticket form's reference data so the form is usable
// the *first* time a foreman opens it offline (otherwise wells/foremen/
// equipment-types come up empty for users who never visited the form
// while online). Called from My Tickets / Maintenance after a fresh
// online list load.

import { cachedFetch } from './cached-fetch'

const LOCATION_TYPES = ['Well', 'Facility'] as const

export async function warmFormCaches(userAssets: string[]): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  // Asset-independent + per-asset prefetches all run in parallel.
  const tasks: Promise<unknown>[] = []

  // Well/facility tree — used by the location dropdowns.
  tasks.push(
    cachedFetch('/api/well-facility', { cacheKey: 'well-facility' }).catch(() => null)
  )

  // Wells and foremen vary by asset — prefetch one of each per assigned asset.
  for (const asset of userAssets) {
    tasks.push(
      cachedFetch(
        `/api/wells/all?asset=${encodeURIComponent(asset)}`,
        { cacheKey: `wells:all:${asset}` }
      ).catch(() => null)
    )
    tasks.push(
      cachedFetch(
        `/api/employees?asset=${encodeURIComponent(asset)}`,
        { cacheKey: `employees:${asset}` }
      ).catch(() => null)
    )
  }

  // Foremen list with no asset filter — covers the auto-select branch in
  // maintenance/new (asset = '' when userAssets is empty for some reason).
  tasks.push(
    cachedFetch('/api/employees?', { cacheKey: 'employees:' }).catch(() => null)
  )

  // Active tickets across the foreman's assets — used by the offline
  // duplicate check in the new-ticket form. Keyed off the comma-joined
  // assets so multi-asset users get all their tickets in one cache entry.
  if (userAssets.length > 0) {
    tasks.push(
      cachedFetch(
        `/api/tickets/active?userAssets=${encodeURIComponent(userAssets.join(','))}`,
        { cacheKey: `active-tickets:${userAssets.join(',')}` }
      ).catch(() => null)
    )
  }

  // AFE lists used by the Repairs / Closeout tab's Work Order Type = AFE
  // flow. Per-well AFEs vary by ticket and aren't pre-warmed here — the
  // detail page's SWR fetch handles those on first open.
  tasks.push(
    cachedFetch('/api/afe', { cacheKey: 'afe:list' }).catch(() => null)
  )
  tasks.push(
    cachedFetch('/api/afe?scope=all', { cacheKey: 'afe:list:all' }).catch(() => null)
  )

  // Pre-warm the equipment *types* per location only. The per-type
  // equipment-name lists were previously warmed here too — 20+ parallel
  // fetches that saturated the browser's per-origin connection pool and
  // backed up KPI / other requests on home-page load. Now that the form
  // uses cachedFetchSwr for equipment names, the first pick per session
  // pays a small lazy fetch and every subsequent pick is instant from
  // cache. Cheap insurance vs. blocking the whole page on speculative
  // prefetches the foreman might never use.
  for (const lt of LOCATION_TYPES) {
    tasks.push(
      cachedFetch(
        `/api/equipment?type=types&locationMatch=${encodeURIComponent(lt)}`,
        { cacheKey: `equipment-types:${lt}` }
      ).catch(() => null)
    )
  }

  await Promise.all(tasks)
}
