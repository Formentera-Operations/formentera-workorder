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

// Query to get all well/facility data for cascade dropdowns
export const WELL_FACILITY_QUERY = `
SELECT
  "UNITID",
  "ROUTENAME",
  "Asset",
  "Area",
  "FIELD",
  "WELLNAME",
  "Facility_Name"
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY
WHERE "Asset" != 'FP WHEELER MIDSTREAM' AND "Asset" != 'FP WHEELER UPSTREAM' AND "Asset" != 'FP WHEELER'
UNION ALL
SELECT
  "UNITID",
  "ROUTENAME",
  "ASSET",
  "AREA",
  "FIELD",
  "WELLNAME",
  "FACILITY_NAME"
FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY_CUSTOM
`

// Query to get all vendors
export const VENDORS_QUERY = `
SELECT * FROM (
  SELECT
      VENDOR_ID,
      ENTITY_ID,
      VENDOR_CODE,
      VENDOR_NAME,
      'DIM_VENDORS' AS SOURCE_TABLE
  FROM FO_PRODUCTION_DB.GOLD_SUPPLY_CHAIN.DIM_VENDOR
  UNION ALL
  SELECT
      NULL AS VENDOR_ID,
      NULL AS ENTITY_ID,
      NULL AS VENDOR_CODE,
      VENDOR_NAME,
      'RETOOL_CUSTOM_VENDORS' AS SOURCE_TABLE
  FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_CUSTOM_VENDORS
) ORDER BY VENDOR_NAME
`
