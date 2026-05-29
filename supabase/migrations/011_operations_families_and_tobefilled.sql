-- Production-visibility: support the CNC Standard Programs import.
--
-- Programs become material/finish VARIANTS grouped into "families" (one base
-- nest geometry, many material/finish variants). Output/input lines may be
-- "to be filled" — the item isn't chosen yet, but the original label + quantity
-- are captured so they stay searchable/resolvable later (mirrors how
-- job_bom_lines allows item_id NULL with a value_text).
--
-- Already applied to the hosted project via the Supabase MCP; this file exists
-- so the schema is reproducible from the repo.

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS family_key     text,
  ADD COLUMN IF NOT EXISTS material_label text,
  -- null = manually entered; a tag like 'cnc_std_v1' marks bulk-imported rows
  -- so the whole import is reversible in one delete.
  ADD COLUMN IF NOT EXISTS import_source  text;

CREATE INDEX IF NOT EXISTS idx_operations_family_key
  ON public.operations USING btree (family_key);

ALTER TABLE public.operation_outputs
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.operation_inputs
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS label text;

-- Backfill existing programs: strip a trailing "(Material)" into material_label;
-- the remainder is the family key.
UPDATE public.operations
SET family_key = COALESCE(family_key, NULLIF(trim(regexp_replace(name, '\s*\([^)]*\)\s*$', '')), '')),
    material_label = COALESCE(material_label, NULLIF(substring(name from '\(([^)]*)\)\s*$'), ''))
WHERE family_key IS NULL;
