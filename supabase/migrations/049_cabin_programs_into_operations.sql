-- Fold Cabin Programs into the main Programs catalogue (operations) so they can
-- be logged in Daily Program Runs and post inventory like any other program.
-- Each cabin program becomes one operation labelled 'Cabin Items', carrying its
-- sheet as an input and its (stocked) outputs as components. The cabin_* tables
-- are kept as a dormant backup; the /cabin-programs and /mrp/cabin routes are
-- retired (redirected) in the same change.
--
-- Idempotent: guarded by import_source='cabin_migration' / NOT EXISTS so a
-- re-run is a no-op. Applied to the remote DB on 2026-06-27.

BEGIN;

INSERT INTO operations
  (name, code, machine, description, notes, audited_at, machining_time_seconds,
   scrap_percent, is_active, program_label, import_source,
   sketch_url, sketch_filename, sketch_uploaded_at, created_at, updated_at)
SELECT cp.name, cp.code, cp.machine, cp.description, cp.notes, cp.audited_at,
       cp.machining_time_seconds, cp.scrap_percent, cp.is_active, 'Cabin Items',
       'cabin_migration',
       cp.sketch_url, cp.sketch_filename, cp.sketch_uploaded_at, now(), now()
FROM cabin_programs cp
WHERE NOT EXISTS (SELECT 1 FROM operations o WHERE o.code = cp.code);

INSERT INTO operation_inputs (operation_id, item_id, qty_per_run, sort_order, created_at)
SELECT o.id, cp.input_sheet_item_id, coalesce(cp.sheets_per_run, 1), 0, now()
FROM cabin_programs cp
JOIN operations o ON o.code = cp.code AND o.import_source = 'cabin_migration'
WHERE cp.input_sheet_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM operation_inputs oi WHERE oi.operation_id = o.id);

INSERT INTO operation_outputs (operation_id, item_id, qty_per_run, role, sort_order, label, created_at)
SELECT o.id, co.item_id, co.qty_per_run, 'component', co.sort_order, co.label, now()
FROM cabin_program_outputs co
JOIN cabin_programs cp ON cp.id = co.cabin_program_id
JOIN operations o ON o.code = cp.code AND o.import_source = 'cabin_migration'
WHERE NOT EXISTS (SELECT 1 FROM operation_outputs oo WHERE oo.operation_id = o.id);

COMMIT;
