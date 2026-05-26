-- Add denormalized BOM columns to job_bom_lines so we can store
-- Ricardo-style category/variant data alongside the (optional) item_id FK.
-- Both representations coexist: item_id for normalized lookups,
-- category+variant for the section-based BOM form and resolver.

-- Make item_id nullable — BOM lines from the section form won't have
-- an item mapping until the user defines the rules.
ALTER TABLE job_bom_lines ALTER COLUMN item_id DROP NOT NULL;

-- Denormalized columns matching the BOM section form structure.
ALTER TABLE job_bom_lines ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE job_bom_lines ADD COLUMN IF NOT EXISTS variant TEXT;
ALTER TABLE job_bom_lines ADD COLUMN IF NOT EXISTS value_text TEXT;

-- Fast lookup by section (category) within a BOM header.
CREATE INDEX IF NOT EXISTS idx_job_bom_lines_category
  ON job_bom_lines(job_bom_id, category);

-- Unique constraint: one value per (header, category, variant).
-- Prevents duplicate leaves on re-save.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_bom_lines_cat_var
  ON job_bom_lines(job_bom_id, category, variant)
  WHERE category IS NOT NULL AND variant IS NOT NULL;
