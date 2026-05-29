-- Operations catalog (Phase 0 of the production-visibility roadmap)
--
-- The factory's atomic unit of production is the *operation* (a CNC / powder /
-- manual program), not the part: one run of a program produces many parts at
-- once (the nest). These tables capture that catalog so institutional
-- knowledge -- "which program makes the car door panel, what it consumes and
-- produces" -- stops living only in people's heads.
--
-- Phase 0 is catalog-only: NO inventory effects. operation_runs (Phase 1) will
-- later post inventory_transactions on completion. Full plan in
-- docs/production-visibility-roadmap.md.
--
-- Also provisions the `program-sketches` storage bucket (public, 50 MB,
-- PDF/PNG/JPG/WebP), mirroring `gad-drawings`, for the per-operation sketch.
--
-- Already applied to the hosted project via the Supabase MCP; this file
-- exists so the schema is reproducible from the repo.

-- 1. operations ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  code               text UNIQUE,
  -- Phase 0 is scoped to CNC Cutting only, so 'cnc_cutting' is the default
  -- and the only value the UI offers. The other (bending / powder coat /
  -- manual) values stay in the constraint for later phases.
  machine            text NOT NULL DEFAULT 'cnc_cutting' CHECK (machine IN (
                       'cnc_cutting','cnc_punch','cnc_laser','cnc_bending',
                       'powder_coat','manual_cut','manual_weld','manual_fit',
                       'assembly_fit')),
  description        text,
  sketch_url         text,
  sketch_filename    text,
  sketch_uploaded_at timestamptz,
  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 2. operation_inputs (raw materials consumed per run) -------------------
CREATE TABLE IF NOT EXISTS public.operation_inputs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  -- NO ACTION on item_id: an item used by an operation can't be hard-deleted
  -- (matches job_bom_lines.item_id), so the catalog never dangles.
  item_id      uuid NOT NULL REFERENCES public.items(id),
  qty_per_run  numeric NOT NULL CHECK (qty_per_run > 0),
  notes        text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 3. operation_outputs (parts produced per run) -- same shape as inputs --
CREATE TABLE IF NOT EXISTS public.operation_outputs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES public.items(id),
  qty_per_run  numeric NOT NULL CHECK (qty_per_run > 0),
  notes        text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operation_inputs_operation_id
  ON public.operation_inputs USING btree (operation_id);
CREATE INDEX IF NOT EXISTS idx_operation_inputs_item_id
  ON public.operation_inputs USING btree (item_id);
CREATE INDEX IF NOT EXISTS idx_operation_outputs_operation_id
  ON public.operation_outputs USING btree (operation_id);
CREATE INDEX IF NOT EXISTS idx_operation_outputs_item_id
  ON public.operation_outputs USING btree (item_id);

-- Permissive RLS, consistent with every other table (auth not yet wired).
ALTER TABLE public.operations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_inputs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for anon" ON public.operations;
CREATE POLICY "Allow all for anon" ON public.operations
  FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for anon" ON public.operation_inputs;
CREATE POLICY "Allow all for anon" ON public.operation_inputs
  FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for anon" ON public.operation_outputs;
CREATE POLICY "Allow all for anon" ON public.operation_outputs
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON public.operations        TO anon, authenticated, service_role;
GRANT ALL ON public.operation_inputs  TO anon, authenticated, service_role;
GRANT ALL ON public.operation_outputs TO anon, authenticated, service_role;

-- 4. program-sketches storage bucket (mirrors gad-drawings) --------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'program-sketches', 'program-sketches', true, 52428800,
  ARRAY['application/pdf','image/png','image/jpeg','image/jpg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "program_sketches_select" ON storage.objects;
CREATE POLICY "program_sketches_select" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'program-sketches');
DROP POLICY IF EXISTS "program_sketches_insert" ON storage.objects;
CREATE POLICY "program_sketches_insert" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'program-sketches');
DROP POLICY IF EXISTS "program_sketches_update" ON storage.objects;
CREATE POLICY "program_sketches_update" ON storage.objects
  FOR UPDATE TO anon, authenticated USING (bucket_id = 'program-sketches') WITH CHECK (bucket_id = 'program-sketches');
DROP POLICY IF EXISTS "program_sketches_delete" ON storage.objects;
CREATE POLICY "program_sketches_delete" ON storage.objects
  FOR DELETE TO anon, authenticated USING (bucket_id = 'program-sketches');
