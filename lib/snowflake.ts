import snowflake from 'snowflake-sdk'

// Snowflake env vars that must be present. Missing any → an explicit error naming
// which one, instead of a cryptic failure deep in the driver.
const REQUIRED_ENV = [
  'SNOWFLAKE_ACCOUNT',
  'SNOWFLAKE_USERNAME',
  'SNOWFLAKE_PRIVATE_KEY',
  'SNOWFLAKE_WAREHOUSE',
] as const

function assertEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k])
  if (missing.length) {
    throw new Error(`Missing required Snowflake env var(s): ${missing.join(', ')}`)
  }
}

// Cache the in-flight connect PROMISE (not the resolved connection) so a burst of
// simultaneous first calls — e.g. the new-ticket form fetching several dropdowns
// at once — share ONE connect instead of each opening their own. Reset to null on
// a failed or dropped connection so the next call redials.
let connectionPromise: Promise<snowflake.Connection> | null = null

function openConnection(): Promise<snowflake.Connection> {
  assertEnv()
  return new Promise((resolve, reject) => {
    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USERNAME!,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey: process.env.SNOWFLAKE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      database: process.env.SNOWFLAKE_DATABASE || 'FO_STAGE_DB',
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
      role: process.env.SNOWFLAKE_ROLE,
    })
    connection.connect((err, conn) => {
      if (err) reject(err)
      else resolve(conn)
    })
  })
}

// Return a live connection: share one connect across concurrent callers, and if
// Snowflake has dropped the cached one (idle timeout), reopen it.
async function getConnection(): Promise<snowflake.Connection> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!connectionPromise) {
      connectionPromise = openConnection().catch((err) => {
        connectionPromise = null // failed connect — don't cache the rejection
        throw err
      })
    }
    const conn = await connectionPromise
    if (conn.isUp()) return conn
    connectionPromise = null // dead connection — drop it and reopen
  }
  throw new Error('Snowflake connection unavailable after reconnect attempt')
}

export async function snowflakeQuery<T = Record<string, unknown>>(
  sql: string,
  binds: unknown[] = []
): Promise<T[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const conn = await getConnection()
    try {
      return await new Promise<T[]>((resolve, reject) => {
        conn.execute({
          sqlText: sql,
          binds: binds as snowflake.Binds,
          complete: (err, _stmt, rows) => (err ? reject(err) : resolve((rows as T[]) || [])),
        })
      })
    } catch (err) {
      // Real query error (connection still up) → surface it. Dropped connection on
      // the first try → reopen and retry once. Safe to retry: every Snowflake
      // query in this app is a read-only SELECT.
      if (attempt === 1 || conn.isUp()) throw err
      connectionPromise = null
    }
  }
  throw new Error('Snowflake query failed after retry')
}

// Query to get all well/facility data for cascade dropdowns.
//
// Wheeler quirk: rows where Asset is FP WHEELER / FP WHEELER MIDSTREAM /
// FP WHEELER UPSTREAM carry their facility name in the NAME column, with
// WELLNAME and Facility_Name both NULL. The CASE expression promotes NAME
// into Facility_Name when TYP1 = 'facility' so those rows show up in the
// cascade dropdown as facilities. Wells (UPSTREAM rows with WELLNAME
// populated) and Wheeler rows with non-facility TYP1 pass through unchanged.
// Midstream master meters are FP WHEELER / FP WHEELER MIDSTREAM facility rows
// whose NAME follows the midstream measurement-point naming convention. They
// are the gas master-meter points, NOT operable facilities, so they get their
// own location type + picker (see MASTER_METER_QUERY) and must be kept OUT of
// the Facility dropdown. The pattern matches the full "MIDSTREAM" suffix plus
// the handful of abbreviated names in the source data ("...MIDST", "...MID",
// and the one "BARTZ, KELTON, STILES GAS SYSTEM" point). Verified against the
// source to select exactly the 83 master meters ops maintains. Shared between
// WELL_FACILITY_QUERY (to exclude them) and MASTER_METER_QUERY (to select
// them) so the two can never drift apart.
const MASTER_METER_NAME_MATCH = `(
    UPPER("NAME") LIKE '%MIDSTREAM%'
    OR UPPER("NAME") LIKE '%MIDST'
    OR UPPER("NAME") LIKE '% MID'
    OR UPPER("NAME") = 'BARTZ, KELTON, STILES GAS SYSTEM'
  )`

// The compressor-station facility UNITIDs (the BARTZ/KELTON/STILES group and
// the MILLS group). These rows ARE compressor stations and are surfaced through
// the dedicated Compressor Station picker (COMPRESSOR_QUERY), so they're kept
// OUT of the Facility dropdown to avoid offering the same thing in two places.
// Shared between WELL_FACILITY_QUERY (to exclude them) and COMPRESSOR_QUERY (to
// select them) so the two can never drift apart.
const COMPRESSOR_STATION_UNITID_LIST = `'43338B7C0FB6451BB428775405C48605', '25A4CEFDF87649EDA4818E771C9DA29D'`

// Wheeler consolidation: the bare FP WHEELER parent asset is folded into
// FP WHEELER MIDSTREAM. Instead of excluding FP WHEELER, both halves of the
// UNION relabel it to FP WHEELER MIDSTREAM in the output "Asset" column so
// its rows appear under the MIDSTREAM bucket in the dropdowns. The CASE for
// Facility_Name still keys off the *original* "Asset" value, so the
// facility-name promotion is unaffected. We still keep FP WHEELER UPSTREAM
// (has wells) and FP WHEELER MIDSTREAM as their normal buckets.
//
// Master meters and the compressor-station facility rows are explicitly
// excluded from the NAME -> Facility_Name promotion (the AND NOT clauses) so
// they don't pollute the Facility dropdown; each surfaces only through its own
// dedicated picker (Master Meters / Compressor Station) instead.
export const WELL_FACILITY_QUERY = `
SELECT
  "UNITID",
  "ROUTENAME",
  CASE WHEN "Asset" = 'FP WHEELER' THEN 'FP WHEELER MIDSTREAM' ELSE "Asset" END AS "Asset",
  "Area",
  "FIELD",
  "WELLNAME",
  CASE
    WHEN "Asset" IN ('FP WHEELER', 'FP WHEELER MIDSTREAM', 'FP WHEELER UPSTREAM')
      AND "WELLNAME" IS NULL
      AND "Facility_Name" IS NULL
      AND LOWER("TYP1") = 'facility'
      AND NOT ${MASTER_METER_NAME_MATCH}
      AND "UNITID" NOT IN (${COMPRESSOR_STATION_UNITID_LIST})
    THEN "NAME"
    ELSE "Facility_Name"
  END AS "Facility_Name"
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY
UNION ALL
SELECT
  "UNITID",
  "ROUTENAME",
  CASE WHEN "ASSET" = 'FP WHEELER' THEN 'FP WHEELER MIDSTREAM' ELSE "ASSET" END AS "ASSET",
  "AREA",
  "FIELD",
  "WELLNAME",
  "FACILITY_NAME"
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY_CUSTOM
`

// Compressor stations for the FP WHEELER MIDSTREAM asset. Each station is a
// finer grain than the well-facility tree: many stations share a single
// facility UNITID, so they don't appear individually in WELL_FACILITY_QUERY.
// The join to RETOOL_WELL_FACILITY (on the facility row) carries the
// Asset/Area/Route/Field over so a selected station can auto-fill the rest of
// the location fields. The two UNITIDs are the BARTZ/KELTON/STILES group and
// the MILLS group — the only compressor facilities in scope today.
export const COMPRESSOR_QUERY = `
SELECT
    c.NAME AS COMPRESSOR_STATION,
    c.COMPRESSORID,
    r."Asset",
    r."Area",
    r."ROUTENAME",
    r."Foreman",
    r."PRODUCTION_ENGINEER",
    r."FIELD",
    c.UNITID
FROM FO_PRODUCTION_DB.REPORTING.COMPRESSOR_V1 c
JOIN FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY r
    ON c.UNITID = r."UNITID"
    AND r."TYP1" = 'facility'
WHERE c.UNITID IN (${COMPRESSOR_STATION_UNITID_LIST})
ORDER BY c.NAME
`

// Midstream master meters for FP WHEELER MIDSTREAM. These ARE facility rows in
// RETOOL_WELL_FACILITY (selected by the same MASTER_METER_NAME_MATCH pattern
// that WELL_FACILITY_QUERY uses to exclude them from the Facility dropdown), so
// the row already carries Asset/Area/Route/Field/Foreman — a selected meter can
// auto-fill the rest of the location fields. Bare FP WHEELER is relabeled to
// FP WHEELER MIDSTREAM to match the well-facility fold.
export const MASTER_METER_QUERY = `
SELECT
    CASE WHEN "Asset" = 'FP WHEELER' THEN 'FP WHEELER MIDSTREAM' ELSE "Asset" END AS "Asset",
    "NAME" AS "MASTER_METER",
    "Area",
    "ROUTENAME",
    "Foreman",
    "PRODUCTION_ENGINEER",
    "FIELD",
    "UNITID"
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY
WHERE "Asset" IN ('FP WHEELER', 'FP WHEELER MIDSTREAM')
  AND "TYP1" = 'facility'
  AND ${MASTER_METER_NAME_MATCH}
ORDER BY "NAME"
`

// Normalizes a vendor name into a comparison key: uppercased, punctuation
// replaced with spaces, common corporate suffixes removed, whitespace collapsed.
// e.g. "Peak Energy Solutions" and "PEAK ENERGY SOLUTIONS LLC" -> "PEAK ENERGY SOLUTIONS".
// Used ONLY to drop free-text Retool custom vendors that duplicate a master vendor;
// master names are never merged with each other (distinct entities share EINs, not names).
const vendorNameKey = (col: string) =>
  `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(` +
  `UPPER(${col}), '[^A-Z0-9 ]', ' '), ` +
  `'\\\\b(LLC|INC|CO|CORP|LTD|LP|LLP|COMPANY|INCORPORATED)\\\\b', ''), '\\\\s+', ' '))`

// Query to get distinct vendor names (the only field the dropdown uses).
// Source of truth is the active-only master (DIM_VENDOR); the legacy Retool
// custom-vendor table is included only for names that don't already resolve to
// a master vendor, so free-text variants don't appear as duplicates.
export const VENDORS_QUERY = `
WITH master AS (
  SELECT VENDOR_NAME
  FROM FO_PRODUCTION_DB.GOLD_SUPPLY_CHAIN.DIM_VENDOR
  WHERE VENDOR_NAME IS NOT NULL AND TRIM(VENDOR_NAME) <> ''
    AND IS_ACTIVE = TRUE
),
master_keys AS (
  SELECT DISTINCT ${vendorNameKey('VENDOR_NAME')} AS nkey FROM master
)
SELECT VENDOR_NAME FROM master
UNION
SELECT VENDOR_NAME
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_CUSTOM_VENDORS
WHERE VENDOR_NAME IS NOT NULL AND TRIM(VENDOR_NAME) <> ''
  AND ${vendorNameKey('VENDOR_NAME')} NOT IN (SELECT nkey FROM master_keys)
ORDER BY VENDOR_NAME
`
