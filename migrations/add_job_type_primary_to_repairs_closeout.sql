-- Add Job_Type_Primary column to Repairs_Closeout.
-- Populated from FO_PRODUCTION_DB.GOLD_DEVELOPMENT.DIM_JOB.JOB_TYPE_PRIMARY
-- for the selected AFE Number on the repairs form.

ALTER TABLE "Repairs_Closeout"
  ADD COLUMN IF NOT EXISTS "Job_Type_Primary" TEXT;
