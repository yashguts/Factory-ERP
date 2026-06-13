-- =====================================================================
-- 021: AI Autofill foundation — label tagging + the learning flywheel.
-- Additive only. NOTHING here touches the locked job-save flow.
--   * jobs.bom_completeness — auto label-quality flag (RAIL = first-phase entered)
--   * job_field_suggestions — one row per AI-suggested field/line (the flywheel fuel)
--   * ai_accuracy_snapshots — one row/day for the keep-rate trend
--   * nightly_ai_maintenance() — re-tags completeness + snapshots the day's metrics
-- pg_cron scheduling is a SEPARATE migration (022) so a cron failure can't
-- roll back this schema. Retrieval derives completeness LIVE from section data,
-- so this column is informational only — no trigger on the hot save path.
-- =====================================================================

-- (1) Completeness label ------------------------------------------------
alter table public.jobs
  add column if not exists bom_completeness text
    check (bom_completeness in ('complete','partial'));

comment on column public.jobs.bom_completeness is
  'Auto-derived BOM label quality for AI training. complete = first-phase entered '
  '(has a RAIL section, gate-correct for every drive type incl. HYD); partial = '
  'first-phase skipped (label noise); NULL = no BOM lines. Maintained by the nightly cron.';

-- Single source of truth for the rule. RAIL is gate=ALWAYS, so it is present on a
-- fully-entered job of ANY drive type (unlike MAIN BRACKET, which is gated off for
-- HYD) — keying on RAIL correctly counts the 2 hydraulic jobs as complete.
create or replace function public.derive_bom_completeness(p_job_id uuid)
returns text language sql stable as $$
  with lines as (
    select l.category
    from public.job_bom_headers h
    join public.job_bom_lines l on l.job_bom_id = h.id
    where h.job_id = p_job_id
  )
  select case
           when not exists (select 1 from lines) then null
           when bool_or(category = 'RAIL') then 'complete'
           else 'partial'
         end
  from lines;
$$;

-- Backfill the existing jobs (expected: 86 complete / 42 partial).
update public.jobs j
  set bom_completeness = public.derive_bom_completeness(j.id)
  where exists (select 1 from public.job_bom_headers h where h.job_id = j.id);

-- (2) The flywheel fuel — one row per suggested field/line ---------------
create table if not exists public.job_field_suggestions (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid references public.jobs(id) on delete cascade,
  drawing_url     text,                          -- which PDF the suggestion came from (null = spec-only)
  engine_version  text not null,                 -- e.g. 'autofill_v1'
  model           text,                          -- e.g. 'claude-opus-4-8' (null for retrieval-only)
  kind            text not null check (kind in ('spec','bom_line')),
  field           text not null,                 -- spec: 'drive_type'|'capacity'|'floors'|... ; bom: the section category
  suggested_value text,                          -- spec value, or item_id of the suggested line
  suggested_qty   numeric,                       -- bom only
  confidence      text check (confidence in ('high','medium','low')),
  provenance      text[] not null default '{}',  -- source job_numbers that voted for this
  applied         boolean not null default false,-- did the engineer click apply on this suggestion
  final_value     text,                          -- what was actually saved (captured on Save)
  final_qty       numeric,                        -- bom only
  outcome         text check (outcome in ('accepted','edited','rejected','added_manually')),
  audited_at      timestamptz,                   -- set when the Save that graded this suggestion ran
  created_at      timestamptz not null default now()
);

comment on table public.job_field_suggestions is
  'AI autofill flywheel: one row per suggested spec field or BOM line. Stores the '
  'suggestion + confidence + provenance + engine version, and after the engineer '
  'saves, the final value + outcome (accepted/edited/rejected/added_manually) for keep-rate.';

create index if not exists idx_jfs_job on public.job_field_suggestions(job_id);
create index if not exists idx_jfs_audited_at on public.job_field_suggestions(audited_at) where audited_at is not null;

-- (3) Daily metric snapshot for the trend dashboard ---------------------
create table if not exists public.ai_accuracy_snapshots (
  snapshot_date       date primary key,
  engine_version      text,
  suggestions_made    integer not null default 0,
  suggestions_audited integer not null default 0,
  fields_total        integer not null default 0,   -- audited rows that were applied
  fields_kept         integer not null default 0,   -- outcome = accepted
  keep_rate           numeric,                        -- kept / total, 0..1
  spec_keep_rate      numeric,
  bom_keep_rate       numeric,
  complete_jobs       integer,
  partial_jobs        integer,
  created_at          timestamptz not null default now()
);

comment on table public.ai_accuracy_snapshots is
  'Daily AI autofill metrics. keep_rate = accepted / (accepted+edited+rejected) over '
  'that day''s audited suggestions; spec/bom split; plus the clean training-pool size.';

-- (4) The unattended daily job (scheduled in migration 022) -------------
create or replace function public.nightly_ai_maintenance()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- (a) keep completeness labels current (catches out-of-band SQL edits + new jobs)
  update public.jobs j
    set bom_completeness = public.derive_bom_completeness(j.id)
    where exists (select 1 from public.job_bom_headers h where h.job_id = j.id)
      and j.bom_completeness is distinct from public.derive_bom_completeness(j.id);

  -- (b) upsert today's metrics from the per-row suggestion log (graded rows only)
  with graded as (
    select * from public.job_field_suggestions
    where outcome in ('accepted','edited','rejected')
      and audited_at is not null
      and (audited_at at time zone 'Asia/Kolkata')::date = v_today
  )
  insert into public.ai_accuracy_snapshots as s (
    snapshot_date, engine_version, suggestions_made, suggestions_audited,
    fields_total, fields_kept, keep_rate, spec_keep_rate, bom_keep_rate,
    complete_jobs, partial_jobs
  )
  select
    v_today,
    (select max(engine_version) from graded),
    (select count(*) from public.job_field_suggestions
       where (created_at at time zone 'Asia/Kolkata')::date = v_today),
    (select count(*) from graded),
    (select count(*) from graded),
    (select count(*) filter (where outcome = 'accepted') from graded),
    nullif((select count(*) filter (where outcome = 'accepted') from graded), 0)::numeric
      / nullif((select count(*) from graded), 0),
    nullif((select count(*) filter (where outcome='accepted' and kind='spec') from graded),0)::numeric
      / nullif((select count(*) filter (where kind='spec') from graded),0),
    nullif((select count(*) filter (where outcome='accepted' and kind='bom_line') from graded),0)::numeric
      / nullif((select count(*) filter (where kind='bom_line') from graded),0),
    (select count(*) from public.jobs where bom_completeness='complete'),
    (select count(*) from public.jobs where bom_completeness='partial')
  on conflict (snapshot_date) do update set
    engine_version=excluded.engine_version, suggestions_made=excluded.suggestions_made,
    suggestions_audited=excluded.suggestions_audited, fields_total=excluded.fields_total,
    fields_kept=excluded.fields_kept, keep_rate=excluded.keep_rate,
    spec_keep_rate=excluded.spec_keep_rate, bom_keep_rate=excluded.bom_keep_rate,
    complete_jobs=excluded.complete_jobs, partial_jobs=excluded.partial_jobs;
end;
$$;

comment on function public.nightly_ai_maintenance() is
  'Unattended daily job: re-tags jobs.bom_completeness for any drift and upserts the '
  'day''s ai_accuracy_snapshots row. No inventory or job-save effects.';

-- RLS — permissive anon, matching every other table in this project.
alter table public.job_field_suggestions enable row level security;
alter table public.ai_accuracy_snapshots enable row level security;
drop policy if exists "Allow all for anon" on public.job_field_suggestions;
create policy "Allow all for anon" on public.job_field_suggestions for all to anon using (true) with check (true);
drop policy if exists "Allow all for anon" on public.ai_accuracy_snapshots;
create policy "Allow all for anon" on public.ai_accuracy_snapshots for all to anon using (true) with check (true);
grant all on public.job_field_suggestions to anon, authenticated, service_role;
grant all on public.ai_accuracy_snapshots to anon, authenticated, service_role;
