-- Watertight Part List: brain-generated, blended-per-line, completion-gated checklist.
-- ADDITIVE ONLY. Touches packing_lists / packing_list_lines exclusively — never the BOM.

-- List-level: ready status + per-part-group disposition (greyed groups bulk-acknowledged).
ALTER TABLE public.packing_lists
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_by text,
  ADD COLUMN IF NOT EXISTS section_dispositions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS generated_source text; -- 'drawing+bom' | 'spec+bom' | 'manual'

-- Line-level: provenance + the per-line confirmation/conflict state.
ALTER TABLE public.packing_list_lines
  ADD COLUMN IF NOT EXISTS source text,            -- 'bom' | 'drawing' | 'formula' | 'neighbour' | 'manual'
  ADD COLUMN IF NOT EXISTS confidence text,         -- 'high' | 'medium' | 'low'
  ADD COLUMN IF NOT EXISTS spec text,               -- specification/size shown to the packer
  ADD COLUMN IF NOT EXISTS is_conflict boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS not_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bom_line_id uuid REFERENCES public.job_bom_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dismissed_reason text;   -- for BOM items intentionally not packed

CREATE INDEX IF NOT EXISTS idx_packing_list_lines_bom_line ON public.packing_list_lines(bom_line_id);

-- RLS already permissive (anon FOR ALL) on both tables from migration 039; new columns inherit it.
