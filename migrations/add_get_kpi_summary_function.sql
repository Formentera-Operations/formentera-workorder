-- Single Postgres function that returns everything the home KPI dashboard
-- needs in one round-trip. The previous /api/kpis fired 9 parallel queries
-- from the Vercel function to Supabase (5 status counts, null rollup,
-- total, aged, trend) — each one a separate HTTPS request with its own
-- TLS handshake and per-request overhead. Network timing showed ~3.5s of
-- "Waiting for server response" even though every individual query was
-- index-fast after add_kpi_indexes_to_maintenance_form_submission.sql.
-- Collapsing to one db.rpc('get_kpi_summary', ...) call cuts the trip
-- count from 9 to 1.
--
-- Run once in the Supabase SQL editor. Idempotent — CREATE OR REPLACE.
--
-- Parameters:
--   user_assets — array of Asset names to filter by. NULL or empty array
--                 means "no filter" (admins / unrestricted users).
--   range_start — first day of the daily-trend range (inclusive).
--   range_end   — last day of the daily-trend range (inclusive).
--
-- Returns a single JSONB object shaped like:
--   {
--     "statusCounts": { "Open": N, "In Progress": N, ... },
--     "agedTickets":  [ { ticket_id, field, equipment, status, days_open }, ... ],
--     "dailyTrend":   [ { date: "YYYY-MM-DD", count: N }, ... ],
--     "total":        N
--   }
-- The dailyTrend entries don't include `label` — the API route adds that
-- because it's locale-aware (weekday-short vs M/D) and easier to format
-- in JS.

CREATE OR REPLACE FUNCTION get_kpi_summary(
  user_assets text[],
  range_start date,
  range_end date
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH filtered AS (
  SELECT id, "Ticket_Status", "Asset", "Issue_Date", "Field", "Equipment"
  FROM "Maintenance_Form_Submission"
  WHERE user_assets IS NULL
     OR cardinality(user_assets) = 0
     OR "Asset" = ANY(user_assets)
),
status_counts AS (
  SELECT COALESCE(
    jsonb_object_agg(grouped_status, c),
    '{}'::jsonb
  ) AS counts
  FROM (
    -- NULL Ticket_Status historically rolled into "Open"; preserve that
    -- so the card counts match the total.
    SELECT COALESCE("Ticket_Status", 'Open') AS grouped_status, COUNT(*) AS c
    FROM filtered
    GROUP BY COALESCE("Ticket_Status", 'Open')
  ) s
),
aged AS (
  SELECT COALESCE(jsonb_agg(t.row ORDER BY t.issue_date ASC), '[]'::jsonb) AS oldest
  FROM (
    SELECT
      "Issue_Date" AS issue_date,
      jsonb_build_object(
        'ticket_id', id,
        'field',     COALESCE("Field", ''),
        'equipment', COALESCE("Equipment", 'Unknown'),
        'status',    "Ticket_Status",
        'days_open', FLOOR(EXTRACT(EPOCH FROM (NOW() - "Issue_Date")) / 86400)::int
      ) AS row
    FROM filtered
    WHERE "Ticket_Status" IN ('Open', 'In Progress', 'Backlogged', 'Awaiting Cost')
      AND id > 700
    ORDER BY "Issue_Date" ASC
    LIMIT 10
  ) t
),
trend_data AS (
  SELECT "Issue_Date"::date AS day, COUNT(*) AS cnt
  FROM filtered
  WHERE "Issue_Date" >= range_start::timestamptz
    AND "Issue_Date" <  (range_end + 1)::timestamptz
  GROUP BY "Issue_Date"::date
),
trend AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date',  to_char(d, 'YYYY-MM-DD'),
        'count', COALESCE(td.cnt, 0)
      ) ORDER BY d
    ),
    '[]'::jsonb
  ) AS daily
  FROM generate_series(range_start::timestamp, range_end::timestamp, '1 day'::interval) d
  LEFT JOIN trend_data td ON td.day = d::date
)
SELECT jsonb_build_object(
  'statusCounts', (SELECT counts FROM status_counts),
  'agedTickets',  (SELECT oldest FROM aged),
  'dailyTrend',   (SELECT daily FROM trend),
  'total',        (SELECT COUNT(*) FROM filtered)
);
$$;

-- Service role (used by the supabaseAdmin client in /api/kpis) can call
-- any function in public by default, but make it explicit.
GRANT EXECUTE ON FUNCTION get_kpi_summary(text[], date, date) TO service_role;
