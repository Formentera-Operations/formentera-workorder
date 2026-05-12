-- Indexes that back the home-screen KPI dashboard's parallel aggregate
-- queries. Without these, COUNT(*) WHERE "Ticket_Status" = 'X' (and the
-- equivalent date-range / aged-tickets queries) do full table scans on
-- Maintenance_Form_Submission — adds up to ~3s per KPI fetch even at
-- ~1,700 rows. With them, each query is an index scan + count and
-- responds in well under 100ms.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Index choices:
--   • Ticket_Status — used by the status-count queries (5 cards on home).
--   • Asset         — used by the user-asset filter on every KPI query.
--   • Issue_Date    — used by the daily trend range scan AND the aged-
--                     tickets ORDER BY (oldest-first LIMIT 10).
--
-- The (Ticket_Status, Issue_Date) composite specifically accelerates the
-- aged-tickets query (WHERE Ticket_Status IN (...) ORDER BY Issue_Date)
-- which is the most expensive single read on the dashboard.

CREATE INDEX IF NOT EXISTS idx_mfs_ticket_status
  ON "Maintenance_Form_Submission" ("Ticket_Status");

CREATE INDEX IF NOT EXISTS idx_mfs_asset
  ON "Maintenance_Form_Submission" ("Asset");

CREATE INDEX IF NOT EXISTS idx_mfs_issue_date
  ON "Maintenance_Form_Submission" ("Issue_Date");

CREATE INDEX IF NOT EXISTS idx_mfs_ticket_status_issue_date
  ON "Maintenance_Form_Submission" ("Ticket_Status", "Issue_Date");
