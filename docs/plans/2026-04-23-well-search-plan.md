---
date: 2026-04-23
topic: well-search
brainstorm: ../brainstorms/2026-04-23-well-search-brainstorm.md
---

# Well Search — Implementation Plan

## Order of operations

Foundation first (Snowflake + Supabase), then backend (API route), then frontend (component → integration → form → save), then verify. Each step is independently testable.

---

## Step 1 — Snowflake: extend `RETOOL_WELL_FACILITY`

**Goal:** expose the stable key and the search blob so the API route has what it needs.

**Action:** re-create the view with added columns. Keep the existing columns in their current order at the top to avoid breaking the `well-facility` API route's transpose (`app/api/well-facility/route.ts:28-34`).

**Additions:**
- `u.name as PVUNIT_NAME`
- `u.WVWellID as WVWELLID`
- `lower(regexp_replace(coalesce(u.wellname,'') || ' ' || coalesce(u.name,'') || ' ' || coalesce(u.unitida,'') || ' ' || coalesce(u.costcenterida,''), '[^a-zA-Z0-9]+', '', 1, 0, 'i')) as SEARCH_BLOB`
- (Optional, deferred) left-join `DIM_WELL` on `u.unitida = dw.api_10` and add `dw.well_name` as a third alias in the blob.

**Verify:**
```sql
select UNITID, WELLNAME, PVUNIT_NAME, WVWELLID, SEARCH_BLOB
from FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY
where UNITID = '2C0B1BD73F9B49D9B4C084B29BB55A0F'
```
Expect the Tubb row with `SEARCH_BLOB` = `tubbjbc43tubbjbc4342103370398070106047`.

**Confirm non-regression:** the existing `/api/well-facility` endpoint still returns the columnar shape it expects (the transpose in `app/api/well-facility/route.ts` only reads columns by name; added columns are ignored there).

---

## Step 2 — Supabase migration

**Action:** add `Well_UNITID` column.
```sql
alter table "Maintenance_Form_Submission"
  add column "Well_UNITID" text null;
```

**Verify:** column exists, existing rows have `NULL`, insert permissions unchanged (`supabaseAdmin` has `service_role`).

**No backfill** — out of scope.

---

## Step 3 — New API route `app/api/wells/search/route.ts`

**File:** `app/api/wells/search/route.ts`

**Signature:** `GET /api/wells/search?q=<string>&asset=<string>`

**Logic:**
1. Parse + trim `q`; lowercase; split on whitespace
2. For each token: strip non-alphanumeric; filter `length >= 2`; cap at 10 tokens
3. If zero tokens → return `[]`
4. Build WHERE: `SEARCH_BLOB ilike ?` AND'd per token; optional `AND "Asset" = ?` if `asset` provided
5. Query Snowflake via `snowflakeQuery` from `lib/snowflake.ts`; parameterize token values as `%token%`
6. Select `UNITID, WELLNAME, PVUNIT_NAME, UNITIDA, WVWELLID, "Asset", "Area", FIELD, ROUTENAME, "Facility_Name"`
7. `order by WELLNAME limit 50`
8. Return `NextResponse.json(rows)`

**Parameterization note:** check whether `lib/snowflake.ts`'s `snowflakeQuery` supports bind params. If not, interpolate tokens only after strict alphanumeric filtering (no quotes possible after strip); still use the snowflake driver's escaping for the `asset` string. Prefer bind if available.

**Verify:**
- `curl '/api/wells/search?q=jb%20tubb%2043'` → returns array including the Tubb well
- `curl '/api/wells/search?q=4210337039'` → returns exactly the Tubb well
- `curl '/api/wells/search?q='` → returns `[]`
- `curl '/api/wells/search?q=a'` → returns `[]` (single-char token filtered)
- `curl '/api/wells/search?q=tubb&asset=FP%20GOLDSMITH'` → Tubb wells scoped to that asset

---

## Step 4 — New component `components/forms/WellSearchPicker.tsx`

**Props:**
```ts
interface WellSearchPickerProps {
  value: string                  // current well name
  assetFilter?: string           // passes through to the API
  disabled?: boolean
  onChange: (val: {
    well: string
    unitId: string
    field: string
    area: string
    route: string
    facility: string
  }) => void
}
```

**Behavior:**
- Controlled input; user types → debounced 300ms → calls `/api/wells/search?q=...&asset=...`
- Renders dropdown list on focus/typing; each row shows `WELLNAME` primary + `PVUNIT_NAME` or `UNITIDA` muted
- Click row → calls `onChange(...)` with the row's values; closes dropdown
- Matches existing UI style from `SearchableSelect` (shadcn or existing design tokens in the repo)
- Empty q → no fetch, no dropdown
- Disabled state when `disabled` prop true (e.g., no asset picked yet)

**Verify:**
- Manual typing `"jb tubb 43"` shows the Tubb well
- Selecting fires `onChange` with all fields populated
- Backspace-clearing the input resets the state

---

## Step 5 — `components/forms/LocationDropdowns.tsx` diff

**Remove Field from Well scoping:** the `const wells = filterOptions(...)` line becomes unused for the new picker — safe to delete (line ~109).

**Replace Well cell:** lines ~151–163 become:
```tsx
{locationType === 'Well' && (
  <div>
    <label className="form-label form-label-required">Well</label>
    <WellSearchPicker
      value={well}
      assetFilter={asset}
      disabled={disabled || !asset}
      onChange={({ well: w, unitId, field: f, area, route }) => {
        setWell(w)
        setFacility('')
        if (f && !field) setField(f)
        emit(asset, f || field, w, '', { unitId, area, route })
      }}
    />
  </div>
)}
```

**Extend `emit` and `onChange` types:**
```ts
interface LocationDropdownsProps {
  // ...
  onChange: (vals: {
    asset: string; field: string; well: string; facility: string;
    area: string; route: string;
    wellUnitId?: string
  }) => void
}

const emit = useCallback((a, f, w, fac, overrides?: {unitId?: string; area?: string; route?: string}) => {
  const { area, route } = overrides ?? getAreaRoute(a, f, w, fac)
  onChange({
    asset: a, field: f, well: w, facility: fac,
    area: overrides?.area ?? area,
    route: overrides?.route ?? route,
    wellUnitId: overrides?.unitId,
  })
}, [getAreaRoute, onChange])
```

**Facility path: untouched.**

**Verify:**
- Picking a well via search back-fills Field if empty; leaves user-picked Field alone if set
- Changing Asset still clears Well + Well_UNITID (cascade-clear behavior preserved)
- Facility flow unchanged

---

## Step 6 — `app/(app)/maintenance/new/page.tsx` diff

**Form state** (line 26):
```ts
Asset: '', Field: '', Well: '', Well_UNITID: '', Facility: '', Area: '', Route: '',
```

**`LocationDropdowns onChange`** (line 154):
```ts
onChange={({ asset, field, well, facility, area, route, wellUnitId }) => {
  setForm(f => ({
    ...f,
    Asset: asset, Field: field, Well: well,
    Well_UNITID: wellUnitId ?? f.Well_UNITID,
    Facility: facility, Area: area, Route: route,
  }))
}}
```

**Submit payload** (in the fetch POST body, find where `form` is serialized — likely `fetch('/api/tickets', { body: JSON.stringify({ ...form, Created_by_Email, Created_by_Name }) })`): `Well_UNITID` flows through via spread.

**Verify:**
- Submitting with a searched well sends `Well_UNITID` in the POST body
- Submitting with Location Type = Facility leaves `Well_UNITID` as empty string → converts to NULL server-side

---

## Step 7 — `app/api/tickets/route.ts` diff

**POST handler** (line 113):
```ts
Well: body.Well || null,
Well_UNITID: body.Well_UNITID || null,
```

**Verify:**
- New ticket row has `Well_UNITID` populated when the form used search
- Existing GET ticket list query unchanged (no `Well_UNITID` in select — the UI doesn't need it yet)

---

## Step 8 — End-to-end verification

1. Run the dev server (`npm run dev` or equivalent from `package.json`)
2. Open `/maintenance/new`, pick Department + Location Type = Well + Asset
3. Search `"jb tubb 43"` in the Well cell → Tubb well appears → click
4. Verify Field auto-populates, Area/Route populate, other cascading state consistent
5. Fill remaining required fields; submit
6. In Supabase, inspect the new row: `Well` = `"Tubb, J B C #43"`, `Well_UNITID` = `"2C0B1BD73F9B49D9B4C084B29BB55A0F"`
7. Regression: pick Location Type = Facility → existing cascade works; pick Asset → Field → Facility; submit; `Well_UNITID` = NULL

---

## Rollout

- No feature flag needed — the change is additive (new column defaulting NULL) and backward-compatible with existing tickets
- The Snowflake view edit is the only shared-surface change; coordinate timing if multiple developers are hitting the retool view concurrently
- Revert path: if the new component has issues, restore the old Well `SearchableSelect` cell in `LocationDropdowns.tsx` (single file revert). Snowflake additions and the Supabase column are harmless idle.

## Out of scope (deferred)

- Facility search upgrade (revisit later)
- Ticket-list search upgrade to use `Well_UNITID` (still string match on `Well`)
- Backfill of `Well_UNITID` for historical tickets
- Well-history or production-data joins that would use the new stable key

## Risks / things to watch

- **`snowflakeQuery` parameterization** — if the driver doesn't support bind parameters, tokens must be sanitized to alphanumeric-only before interpolation (they already are by step 3's logic, but worth explicit check)
- **Debounce edge case** — rapid token typing could leave stale results visible; standard pattern is to track request IDs and discard out-of-order responses
- **Short tokens** — `"43"` matches many wells (API prefix). Expected behavior; surface in a help tooltip if users complain
