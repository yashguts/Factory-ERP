-- 039 — Packing lists
--
-- A packing list is the COMPREHENSIVE per-job shipment checklist the factory
-- builds by hand from the job's BOM. It follows the finished-stock register's
-- canonical section order (see src/lib/packing-list/packing-list-sections.ts).
--
-- Phase 0: a DOCUMENT only — no inventory or dispatch effect (dispatch stays the
-- source of truth for what actually shipped + stock deduction). One packing list
-- per job; lines are grouped under a register section_key and ordered within it.

CREATE TABLE IF NOT EXISTS packing_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  note text,
  -- set once the list has been seeded from the job's BOM, so re-opening it
  -- never re-seeds (and never clobbers the packer's edits).
  seeded_from_bom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id)
);

CREATE TABLE IF NOT EXISTS packing_list_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packing_list_id uuid NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
  -- which register section this row sits under (packing-list-sections.ts key,
  -- e.g. 'fs-007', 'dp-001'). Drives grouping + order on the page.
  section_key text NOT NULL,
  -- the item being packed; NULL = a free-text row (label only) not yet matched
  -- to inventory. Items referenced here can't be hard-deleted (NO ACTION).
  item_id uuid REFERENCES items(id) ON DELETE NO ACTION,
  -- captured/free-text name when item_id is NULL.
  label text,
  qty numeric NOT NULL DEFAULT 0,
  note text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packing_lists_job ON packing_lists(job_id);
CREATE INDEX IF NOT EXISTS idx_packing_list_lines_list ON packing_list_lines(packing_list_id);
CREATE INDEX IF NOT EXISTS idx_packing_list_lines_section ON packing_list_lines(packing_list_id, section_key);
CREATE INDEX IF NOT EXISTS idx_packing_list_lines_item ON packing_list_lines(item_id);

-- Permissive anon RLS — matches every other table pre-auth.
ALTER TABLE packing_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_list_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON packing_lists FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON packing_list_lines FOR ALL TO anon USING (true) WITH CHECK (true);
