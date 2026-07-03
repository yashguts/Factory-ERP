-- Foundation for "Packing List R1 runs the ERP": R1 becomes the primary editor
-- and MIRRORS into job_bom_lines (the demand/dispatch backbone) so every
-- downstream consumer (MRP, weekly, dispatch, cabin, procurement) keeps reading
-- the same rows unchanged. See src/lib/actions/r1-bom-sync.ts.

-- Provenance marker: 'r1' = line mirrored from the job's Packing List R1;
-- NULL = legacy line written by the old BOM form (kept until reviewed via the
-- R1 "Unmapped Items" panel).
alter table public.job_bom_lines add column if not exists source text;
create index if not exists idx_job_bom_lines_source on public.job_bom_lines(source) where source is not null;

-- Cross-off now also removes the legacy BOM line (clearing its MRP demand);
-- keep a full snapshot of what was removed so it's reversible.
alter table public.packing_r1_unmapped_dismissed add column if not exists removed_bom_lines jsonb;

-- Audit trail for "mark final going forward": who reviewed the R1 list & when.
alter table public.packing_r1_lists add column if not exists audited_at timestamptz;
alter table public.packing_r1_lists add column if not exists audited_by text;
