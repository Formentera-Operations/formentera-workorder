-- Run this in the Supabase SQL editor AFTER the migration script completes.
-- It advances each SERIAL sequence to MAX(id) so subsequent auto-id inserts
-- do not collide with the ids imported from Retool.

SELECT setval(pg_get_serial_sequence('"Maintenance_Form_Submission"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "Maintenance_Form_Submission"), 0), 1));
SELECT setval(pg_get_serial_sequence('"Dispatch"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "Dispatch"), 0), 1));
SELECT setval(pg_get_serial_sequence('"Repairs_Closeout"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "Repairs_Closeout"), 0), 1));
SELECT setval(pg_get_serial_sequence('"vendor_payment_details"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "vendor_payment_details"), 0), 1));
SELECT setval(pg_get_serial_sequence('"comments"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "comments"), 0), 1));
