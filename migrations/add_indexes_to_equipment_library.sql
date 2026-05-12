-- Indexes backing the /api/equipment endpoint queries. Without them, each
-- "load equipment types for Well" or "load equipment names for Well +
-- Compressor" did a sequential scan of equipment_library — fine for a
-- small table but it stacked up badly when warmFormCaches fired 20+
-- parallel requests at once and saturated the Supabase connection pool.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Query patterns covered:
--   • type=types     → WHERE match_type = X
--   • type=equipment → WHERE match_type = X AND type = Y
-- A composite on (match_type, type) handles both shapes because Postgres
-- can use the leading column alone for the simpler query.

CREATE INDEX IF NOT EXISTS idx_equipment_library_match_type_type
  ON equipment_library (match_type, type);
