-- Refresh workorder_ticket_summary to expose columns added after the initial migration,
-- so the Analysis "Ask AI" chat (and any other consumers) can read them.
--
-- New columns being added at the end of the view:
--   m."Well_UNITID"               → well_unitid          (cross-system well joins)
--   rc."AFE_Number"               → afe_number           (AFE Execute integration)
--   rc."Job_Category"             → job_category         (from DIM_JOB.JOB_CATEGORY)
--   rc."Job_Type_Primary"         → job_type_primary     (from DIM_JOB.JOB_TYPE_PRIMARY)
--
-- Also exposing existing maintenance/dispatch fields that the original view skipped
-- and that are useful for AI questions:
--   m."Troubleshooting_Conducted" → troubleshooting_conducted
--   m."Self_Dispatch_Assignee"    → self_dispatch_assignee
--   m.assigned_foreman            → assigned_foreman
--   m."Created_by_Email"          → created_by_email
--
-- CREATE OR REPLACE VIEW requires the original column list (in the original order)
-- to remain unchanged — new columns can only be appended at the end.

CREATE OR REPLACE VIEW workorder_ticket_summary AS
WITH latest_dispatch AS (
  SELECT
    d.*,
    ROW_NUMBER() OVER (
      PARTITION BY d.ticket_id
      ORDER BY
        (d."Estimate_Cost" IS NOT NULL) DESC,
        d.date_assigned DESC NULLS LAST,
        d.created_at DESC,
        d.id DESC
    ) AS rn
  FROM "Dispatch" d
),
latest_closeout AS (
  SELECT
    rc.*,
    ROW_NUMBER() OVER (
      PARTITION BY rc.ticket_id
      ORDER BY
        COALESCE(rc.date_closed, rc.date_completed, rc.start_date, rc.created_at) DESC,
        rc.id DESC
    ) AS rn
  FROM "Repairs_Closeout" rc
)
SELECT
  -- ── Original columns (unchanged order) ─────────────────────────────
  m.id                                       AS ticket_id,
  m."Department"                             AS department,
  m."Issue_Date"                             AS issue_date,
  COALESCE(rc."Work_Order_Type", m."Work_Order_Type") AS work_order_type,
  COALESCE(d."Estimate_Cost", m."Estimate_Cost") AS "Estimate_Cost",
  COALESCE(rc."Priority_of_Issue", m."Priority_of_Issue") AS priority_of_issue,
  m."Issue_Description"                      AS issue_description,
  m."Location_Type"                          AS location_type,
  m."Equipment_Type"                         AS equipment_type,
  m."Equipment"                              AS equipment_name,
  m."Asset"                                  AS asset,
  m."Area"                                   AS area,
  m."Field"                                  AS field,
  m."Route"                                  AS route,
  m."Well"                                   AS well,
  m."Facility"                               AS facility,
  m."Ticket_Status"                          AS ticket_status,
  d.work_order_decision,
  d.self_dispatch_assignee,
  d.production_foreman,
  d.maintenance_foreman,
  d.date_assigned,
  d.due_date,
  rc.final_status,
  rc.start_date          AS repair_start_date,
  rc.repair_details,
  rc.vendor              AS repair_vendor,
  rc.total_repair_cost,
  rc.date_completed      AS repair_date_completed,
  rc.date_closed         AS repair_date_closed,
  rc.closed_by,
  vpd.total_cost         AS repair_cost,
  m."Created_by_Name"                        AS created_by,

  -- ── New / newly exposed columns (appended) ─────────────────────────
  m."Well_UNITID"                            AS well_unitid,
  rc."AFE_Number"                            AS afe_number,
  rc."Job_Category"                          AS job_category,
  rc."Job_Type_Primary"                      AS job_type_primary,
  m."Troubleshooting_Conducted"              AS troubleshooting_conducted,
  m."Self_Dispatch_Assignee"                 AS ticket_self_dispatch_assignee,
  m.assigned_foreman                         AS assigned_foreman,
  m."Created_by_Email"                       AS created_by_email
FROM "Maintenance_Form_Submission" m
LEFT JOIN latest_dispatch d
  ON d.ticket_id = m.id AND d.rn = 1
LEFT JOIN latest_closeout rc
  ON rc.ticket_id = m.id AND rc.rn = 1
LEFT JOIN vendor_payment_details vpd
  ON vpd.ticket_id = m.id
ORDER BY m.id;
