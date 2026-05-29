-- Audit tracking for Programs.
--
-- After the bulk CNC Standard Programs import, programs need to be reviewed one
-- by one (confirm machine, fill the to-be-filled output items, fix quantities).
-- `audited_at` records when a program was signed off; the Programs page shows
-- progress and lets you filter pending vs audited.
--
-- Already applied to the hosted project via the Supabase MCP; this file exists
-- so the schema is reproducible from the repo.

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS audited_at timestamptz,
  ADD COLUMN IF NOT EXISTS audited_by text;

CREATE INDEX IF NOT EXISTS idx_operations_audited_at
  ON public.operations USING btree (audited_at);
