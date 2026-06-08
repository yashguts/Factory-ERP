-- Cabin jobs: a job number with cabin inventory items grouped by the 11 cabin
-- types. Standalone from the main job orders (just a number for now).

CREATE TABLE IF NOT EXISTS cabin_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text NOT NULL,
  customer_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cabin_jobs_job_number_key
  ON cabin_jobs (lower(btrim(job_number)));

CREATE TABLE IF NOT EXISTS cabin_job_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabin_job_id uuid NOT NULL REFERENCES cabin_jobs(id) ON DELETE CASCADE,
  cabin_type text NOT NULL,
  item_id uuid REFERENCES items(id) ON DELETE NO ACTION,
  qty numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cabin_job_lines_job ON cabin_job_lines(cabin_job_id);

ALTER TABLE cabin_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabin_job_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON cabin_jobs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON cabin_job_lines FOR ALL TO anon USING (true) WITH CHECK (true);
