import snowflake from 'snowflake-sdk'

let connectionPool: snowflake.Connection | null = null

function getConnection(): Promise<snowflake.Connection> {
  return new Promise((resolve, reject) => {
    if (connectionPool) {
      resolve(connectionPool)
      return
    }

    const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY!.replace(/\\n/g, '\n')

    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USERNAME!,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey,
      database: process.env.SNOWFLAKE_DATABASE || 'FO_STAGE_DB',
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
      role: process.env.SNOWFLAKE_ROLE,
    })

    connection.connect((err, conn) => {
      if (err) {
        reject(err)
        return
      }
      connectionPool = conn
      resolve(conn)
    })
  })
}

export async function snowflakeQuery<T = Record<string, unknown>>(
  sql: string,
  binds: unknown[] = []
): Promise<T[]> {
  const conn = await getConnection()
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds: binds as snowflake.Binds,
      complete: (err, _stmt, rows) => {
        if (err) {
          reject(err)
          return
        }
        resolve((rows as T[]) || [])
      },
    })
  })
}

// Query to get all well/facility data for cascade dropdowns.
//
// Wheeler quirk: rows where Asset is FP WHEELER / FP WHEELER MIDSTREAM /
// FP WHEELER UPSTREAM carry their facility name in the NAME column, with
// WELLNAME and Facility_Name both NULL. The CASE expression promotes NAME
// into Facility_Name when TYP1 = 'facility' so those rows show up in the
// cascade dropdown as facilities. Wells (UPSTREAM rows with WELLNAME
// populated) and Wheeler rows with non-facility TYP1 pass through unchanged.
// Wheeler consolidation: the bare FP WHEELER parent asset is folded into
// FP WHEELER MIDSTREAM. Instead of excluding FP WHEELER, both halves of the
// UNION relabel it to FP WHEELER MIDSTREAM in the output "Asset" column so
// its rows appear under the MIDSTREAM bucket in the dropdowns. The CASE for
// Facility_Name still keys off the *original* "Asset" value, so the
// facility-name promotion is unaffected. We still keep FP WHEELER UPSTREAM
// (has wells) and FP WHEELER MIDSTREAM as their normal buckets.
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
WHERE c.UNITID IN (
    '43338B7C0FB6451BB428775405C48605',
    '25A4CEFDF87649EDA4818E771C9DA29D'
)
ORDER BY c.NAME
`

// Query to get distinct vendor names (the only field the dropdown uses).
// UNION (not UNION ALL) dedupes across the two source tables and within each.
export const VENDORS_QUERY = `
SELECT VENDOR_NAME 
FROM FO_PRODUCTION_DB.GOLD_SUPPLY_CHAIN.DIM_VENDOR
WHERE VENDOR_NAME IS NOT NULL AND TRIM(VENDOR_NAME) <> ''
UNION
SELECT VENDOR_NAME 
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_CUSTOM_VENDORS
WHERE VENDOR_NAME IS NOT NULL AND TRIM(VENDOR_NAME) <> ''
ORDER BY VENDOR_NAME
`
