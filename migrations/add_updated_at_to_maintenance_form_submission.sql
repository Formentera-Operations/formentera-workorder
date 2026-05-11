-- Adds an auto-maintained updated_at on Maintenance_Form_Submission so the
-- offline conflict guard has a real, base-table-anchored version stamp.
-- The view-computed last_activity_ts can't be relied on (it isn't always
-- bumped on side-table changes like Dispatch inserts).
--
-- Run once in the Supabase SQL editor before deploying the API change.

ALTER TABLE "Maintenance_Form_Submission"
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION bump_maintenance_form_submission_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_maintenance_form_submission_updated_at
  ON "Maintenance_Form_Submission";

CREATE TRIGGER trg_bump_maintenance_form_submission_updated_at
  BEFORE UPDATE ON "Maintenance_Form_Submission"
  FOR EACH ROW
  EXECUTE FUNCTION bump_maintenance_form_submission_updated_at();
