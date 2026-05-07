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

  // Equipment is two-tier: types (per location), then names (per location +
  // type). We chain these so each location's per-type equipment lists fire
  // as soon as we know what types exist.
  for (const lt of LOCATION_TYPES) {
    tasks.push(
      (async () => {
        try {
          const { data } = await cachedFetch<Array<{ equipment_type?: string }>>(
            `/api/equipment?type=types&locationMatch=${encodeURIComponent(lt)}`,
            { cacheKey: `equipment-types:${lt}` }
          )
          const types = (Array.isArray(data) ? data : [])
            .map(r => r?.equipment_type)
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
          await Promise.all(
            types.map(t =>
              cachedFetch(
                `/api/equipment?type=equipment&equipmentType=${encodeURIComponent(t)}&locationMatch=${lt}`,
                { cacheKey: `equipment:${lt}:${t}` }
              ).catch(() => null)
            )
          )
        } catch {
          /* ignore — best-effort warm */
        }
      })()
    )
  }

  await Promise.all(tasks)
}
