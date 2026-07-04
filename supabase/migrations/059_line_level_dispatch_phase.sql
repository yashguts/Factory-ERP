-- LINE-LEVEL dispatch phases (owner's packing-list phase sheet, 2026-07-04).
-- Phase classification was per SECTION (part title / old BOM category). The
-- owner's sheet keeps every part's default but marks 3 line-level exceptions —
-- Phase-2 items living inside Phase-1 parts. NULL = inherit the section default
-- (dispatchPhaseOf), so template additions keep working without maintenance.

alter table public.packing_template_lines
  add column if not exists dispatch_phase smallint
  check (dispatch_phase in (1, 2));

alter table public.job_bom_lines
  add column if not exists dispatch_phase smallint
  check (dispatch_phase in (1, 2));

-- The owner's 3 exceptions (Buffer Spring; Collapsible Top track CAR — the
-- LANDING track stays phase 1; Gate Lock):
update public.packing_template_lines set dispatch_phase = 2
where id in (
  '1261032f-6f9c-47ea-8d66-0ba868b3d4cb',  -- Buffer Channel > Buffer Spring
  '1418121c-32f9-4c21-ba30-3cf4f7f72a01',  -- Door Frame > Collapsible Top track Car
  'f7bdb651-e2a1-4cf8-8ad4-00b30ad0c05a'   -- Door Frame > Gate Lock
);

-- Backfill mirrored job lines: any job whose packing list carries one of the
-- exception lines gets the explicit phase on its mirrored BOM line.
update public.job_bom_lines bl
set dispatch_phase = 2
from packing_r1_lines pl
join packing_r1_lists l on l.id = pl.list_id
join job_bom_headers h on h.job_id = l.job_id
where bl.job_bom_id = h.id
  and bl.item_id = pl.item_id
  and bl.source = 'r1'
  and pl.template_line_id in (
    '1261032f-6f9c-47ea-8d66-0ba868b3d4cb',
    '1418121c-32f9-4c21-ba30-3cf4f7f72a01',
    'f7bdb651-e2a1-4cf8-8ad4-00b30ad0c05a'
  );
