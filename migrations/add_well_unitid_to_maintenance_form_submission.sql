-- Add Well_UNITID column to Maintenance_Form_Submission for cross-system well joins.
-- Stores the pvunit IDREC (from RETOOL_WELL_FACILITY.UNITID) alongside the existing Well name,
-- so a ticket can be joined to ProdView, WellView, and DIM_WELL without fuzzy name matching.

ALTER TABLE "Maintenance_Form_Submission"
  ADD COLUMN IF NOT EXISTS "Well_UNITID" TEXT;
