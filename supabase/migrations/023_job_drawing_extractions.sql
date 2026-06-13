-- =====================================================================
-- 023: rich drawing extractions — the deep-learning dataset foundation.
-- Every time a drawing is read (piggybacking the existing autofill call, no
-- extra cost), store the FULL extracted content here, tied to the job. Paired
-- with the job's final human-audited BOM (job_bom_lines) + the suggestion
-- outcomes (job_field_suggestions), this is the (drawing -> correct job) corpus
-- the months-long deep study learns from. Additive; no effect on any other flow.
-- =====================================================================
create table if not exists public.job_drawing_extractions (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid references public.jobs(id) on delete cascade,
  drawing_url      text,
  drawing_filename text,
  -- the FULL structured read: core spec + dimensions + every labelled value
  extracted        jsonb not null default '{}'::jsonb,
  -- the normalised spec subset the autofill uses (drive_type/floors/capacity/...)
  spec             jsonb not null default '{}'::jsonb,
  model            text,
  schema_version   text not null default 'rich_v1',
  -- discrepancies vs the job's entered spec at read time (the first "the data
  -- disagrees with what's recorded" signal for deep vetting)
  discrepancies    jsonb not null default '[]'::jsonb,
  extracted_at     timestamptz not null default now()
);

comment on table public.job_drawing_extractions is
  'Rich per-job drawing reads (full content), captured on every autofill. Paired '
  'with job_bom_lines + job_field_suggestions, this is the deep-study training '
  'corpus: drawing content -> human-verified job values, accumulating over months.';

create index if not exists idx_jde_job on public.job_drawing_extractions(job_id);
create index if not exists idx_jde_at on public.job_drawing_extractions(extracted_at);

alter table public.job_drawing_extractions enable row level security;
drop policy if exists "Allow all for anon" on public.job_drawing_extractions;
create policy "Allow all for anon" on public.job_drawing_extractions for all to anon using (true) with check (true);
grant all on public.job_drawing_extractions to anon, authenticated, service_role;
