-- Program labels: a grouping for sets of programs.
--
-- Everything on the ERP at this point came from the "Std Program" sheet, so all
-- existing programs are labelled "Standard Programs". Future program sets
-- (e.g. custom / customer-specific) will use other labels.
--
-- Already applied to the hosted project via the Supabase MCP; this file exists
-- so the schema is reproducible from the repo.

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS program_label text;

CREATE INDEX IF NOT EXISTS idx_operations_program_label
  ON public.operations USING btree (program_label);

UPDATE public.operations
SET program_label = 'Standard Programs'
WHERE program_label IS NULL;
