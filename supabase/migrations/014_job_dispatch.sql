-- Job dispatch: record what physically ships against a job, in one or more
-- dated dispatches (first phase / second phase / full), with partial quantities
-- and item/qty edits independent of the job's BOM. NO inventory effect (stock is
-- managed manually elsewhere for now).

CREATE TABLE IF NOT EXISTS job_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  dispatch_date date NOT NULL,
  phase_scope text NOT NULL CHECK (phase_scope IN ('first','second','full')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_dispatches_job ON job_dispatches(job_id);

CREATE TABLE IF NOT EXISTS job_dispatch_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES job_dispatches(id) ON DELETE CASCADE,
  job_bom_line_id uuid REFERENCES job_bom_lines(id) ON DELETE SET NULL,
  item_id uuid REFERENCES items(id) ON DELETE NO ACTION,
  category text,
  label text,
  qty numeric NOT NULL CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_dispatch_lines_dispatch ON job_dispatch_lines(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_job_dispatch_lines_bomline ON job_dispatch_lines(job_bom_line_id);

ALTER TABLE job_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_dispatch_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON job_dispatches FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON job_dispatch_lines FOR ALL TO anon USING (true) WITH CHECK (true);
