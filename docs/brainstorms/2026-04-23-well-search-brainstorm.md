---
date: 2026-04-23
topic: well-search
---

# Well Search with Cross-System Name Resolution

## What We're Building

An upgrade to the Well cell in the maintenance form. Today the Well dropdown is a static list scoped by Asset + Field, showing wells in one specific spelling (the pvunitcomp `WELLNAME`). Users who know a well by a different name — the DIM_WELL spelling, the WellView spelling, the API number, or the EID — can't find it.

After the upgrade, the Well cell is a debounced search box. The user picks Location Type = Well and Asset as today, then types any spelling or ID fragment. The search surfaces the well, and picking it auto-populates Field, Area, and Route. A stable `UNITID` is saved alongside the well name to enable future cross-system joins.

Facility path is untouched in this change — revisit later.

## Why This Approach

Three approaches were considered:

- **A: DIM_WELL as the hub + new V_WELL_SEARCH view** — Rejected because it complicates the lineage and DIM_WELL lacks 100% coverage of operated wells (`WVWELLID` only on ~59%).
- **B: Extend the existing RETOOL_WELL_FACILITY view** — Chosen. `unit_v2` (its source) already joins pvunit + pvunitcomp + WellView integration, already filters `operated = 1`, and already carries every field we need plus `UNITID` (the pvunit IDREC) as a 100%-coverage stable key.
- **C: Snowflake Cortex Search** — Rejected. Overkill for ~7k operated wells; lexical normalization + token matching solves the real problem.

For the matching algorithm, token-based substring matching (`B2`) was chosen over single-blob substring (`B1`) because `"tubb 43"` and similar natural searches otherwise return zero results.

## Key Decisions

- **Search algorithm**: Token-based. Split user input on whitespace, strip non-alphanumeric, require every token (≥2 chars, cap 10 tokens) to appear as substring in `SEARCH_BLOB`. Rationale: handles word reorder, mixed source-system spellings, and API/EID in the same input.
- **Blob normalization**: Strip **all** non-alphanumeric characters (punctuation AND whitespace). Rationale: makes `"jb"` matchable in names spelled `"J. B."` or `"J B"`.
- **Hub view**: Extend `FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY` (built on `unit_v2`). Rationale: already the dropdown's source, already scoped to operated wells.
- **Canonical display name**: `WELLNAME` (pvunitcomp spelling — e.g., `"Tubb, J B C #43"`). Rationale: matches existing Supabase `Well` column values; prevents a spelling split between historical and new tickets.
- **Stable ID stored in Supabase**: `Well_UNITID` (pvunit `IDREC`). Rationale: 100% coverage across operated wells; `WVWELLID`/`EID` drop to ~59%. `UNITID` can forward-join to all other systems.
- **Well scoping**: Asset only (not Asset + Field). Rationale: Field becomes optional-before-Well; picking a Well back-fills Field.
- **Ordering**: Alphabetical by `WELLNAME`.
- **Result cap**: 50.
- **Empty input behavior**: Return empty (no bulk "all wells" dump).
- **Location Type + Facility**: No changes. Facility upgrade deferred.

## Components

1. **Snowflake** — Extend `RETOOL_WELL_FACILITY` to add `UNITID` (already exposed), `PVUNIT_NAME` (from `u.name`), `WVWELLID`, and `SEARCH_BLOB` (`lower(regexp_replace(WELLNAME || ' ' || NAME || ' ' || UNITIDA || ' ' || COSTCENTERIDA, '[^a-zA-Z0-9]+', '', 1, 0, 'i'))`). Optionally left-join `DIM_WELL` on `UNITIDA = API_10` for a third name alias.
2. **Supabase migration** — `alter table "Maintenance_Form_Submission" add column "Well_UNITID" text null;`
3. **API route** — New `app/api/wells/search/route.ts`. Accepts `?q=...&asset=...`, tokenizes, builds parameterized `where SEARCH_BLOB ilike ?` per token, returns rows with `UNITID, WELLNAME, NAME, UNITIDA, WVWELLID, Asset, Area, FIELD, ROUTENAME, Facility_Name`.
4. **Component** — New `components/forms/WellSearchPicker.tsx`. Debounced combobox (~300ms), primary line = `WELLNAME`, secondary = `NAME` / `UNITIDA`. On select, emits `{ well, unitId, field, area, route }`.
5. **`LocationDropdowns.tsx`** — Swap the Well `SearchableSelect` for `WellSearchPicker`. Remove Field from Well scoping. Extend `emit` to forward `unitId` and accept authoritative area/route overrides from the search picker. Extend `onChange` prop shape with optional `wellUnitId`.
6. **`app/(app)/maintenance/new/page.tsx`** — Add `Well_UNITID` to form state; wire it through the `LocationDropdowns` onChange; include in submit payload.
7. **`app/api/tickets/route.ts`** — Insert `Well_UNITID: body.Well_UNITID || null` alongside `Well`.

## What Stays the Same

- Location Type dropdown (Well vs Facility) + its reset behavior
- Asset dropdown
- Facility cascade path (Asset → Field → Facility)
- Area + Route derivation (search picker provides authoritative values; fallback to `getAreaRoute` otherwise)
- Auto-fill narrowing logic
- Ticket list search (`Well.ilike.%...%` still operates on the name string)
- Email templates
- All existing tickets (`Well_UNITID` defaults to NULL)
- `Maintenance_Form_Submission.Well` keeps its current spelling convention

## Known Tradeoffs

- Short numeric tokens like `"43"` match many wells (every Andrews County API starts with `42103...`). Users refine by adding tokens or typing the full well name. Not worth a ranking heuristic in MVP.
- DIM_WELL-only wells (not in `unit_v2`) remain unselectable. Same as today, so not a regression.
- 41% of operated wells have no `WVWELLID`. Not an issue for this feature since `UNITID` is the key; WellView joins would simply return NULL for those wells in future features.

## Open Questions

- Does the view need to expose the `DIM_WELL.WELL_NAME` alias in the blob (third spelling)? Likely yes for full spelling coverage; confirm at implementation.
- Should the `WellSearchPicker` debounce live on the client (300ms) or rely on a server-side rate limit? Start with client-side debounce.

## Next Steps

→ `/workflows:plan` for step-by-step implementation
