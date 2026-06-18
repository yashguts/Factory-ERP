-- =====================================================================
-- 039: GAD version history + BOM-vs-GAD drift alert + job audit trail.
--
-- The operational problem: Sales uploads a GAD (General Arrangement Drawing)
-- and the Factory defines the Job BOM from it. If the GAD is later re-uploaded
-- /changed AFTER the BOM was defined, the BOM / cut programs / procurement /
-- dispatch silently go stale with no signal. Today recordGadDrawing even
-- HARD-DELETES the previous drawing, so there is no history at all.
--
-- This migration introduces:
--   1. job_gad_versions       — one immutable row per uploaded GAD (files kept).
--   2. denormalised state on jobs (the alert is a pure function of the jobs row,
--      so list/detail/board screens need ZERO extra queries).
--   3. three helper functions for the atomic column-to-column updates that
--      supabase-js cannot express (set X = <other column>).
--   4. a backfill that baselines every EXISTING job as "already audited at the
--      current revision" so nothing lights up red on day one — the alert only
--      ever fires for a GAD change that happens AFTER this migration.
--
-- Additive + backfilled; no destructive change to existing data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Version history table (one row per uploaded GAD; files are kept).
-- ---------------------------------------------------------------------
create table if not exists public.job_gad_versions (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  revision_no   integer not null,                 -- 1,2,3 ... per job
  storage_path  text not null,                    -- {jobId}/{ts}-{name} in gad-drawings bucket
  url           text not null,                    -- public URL (mirror of jobs.gad_drawing_url)
  filename      text not null,
  is_current    boolean not null default true,    -- exactly one true per job (partial-unique below)
  uploaded_by   text,                             -- operator identity; 'unknown' until wired
  uploaded_at   timestamptz not null default now(),
  unique (job_id, revision_no)
);

create index if not exists idx_job_gad_versions_job on public.job_gad_versions(job_id);
-- Enforce at most one current version per job (no race on the flip-then-insert).
create unique index if not exists uniq_job_gad_current
  on public.job_gad_versions(job_id) where is_current;

alter table public.job_gad_versions enable row level security;
drop policy if exists "Allow all for anon" on public.job_gad_versions;
create policy "Allow all for anon" on public.job_gad_versions for all to anon using (true) with check (true);
grant all on public.job_gad_versions to anon, authenticated, service_role;

comment on table public.job_gad_versions is
  'GAD drawing version history: one immutable row per upload. is_current marks the '
  'live drawing (mirrored onto jobs.gad_drawing_*). Files are retained on replace.';

-- ---------------------------------------------------------------------
-- 2. Denormalised state on jobs (the drift alert is a pure function of these).
-- ---------------------------------------------------------------------
alter table public.jobs
  -- GAD versioning: live revision number (0 = no GAD has ever been uploaded).
  add column if not exists gad_revision_no      integer not null default 0,
  -- BOM baseline: the GAD revision the BOM was first defined against.
  add column if not exists bom_defined_at       timestamptz,
  add column if not exists bom_gad_baseline_rev integer,
  -- Audit acknowledgement ("Marked Audited with changes").
  add column if not exists bom_audited_at       timestamptz,
  add column if not exists bom_audited_by        text,
  add column if not exists bom_audited_gad_rev  integer,
  -- Identity (no auth wired yet): structured now, 'unknown' until an operator is set.
  add column if not exists created_by            text,
  add column if not exists gad_uploaded_by       text;

comment on column public.jobs.gad_revision_no is
  'Live GAD revision (max revision_no in job_gad_versions). 0 = no GAD uploaded.';
comment on column public.jobs.bom_gad_baseline_rev is
  'GAD revision present when the Job BOM was first defined (bom_defined_at).';
comment on column public.jobs.bom_audited_gad_rev is
  'GAD revision acknowledged at the last "Mark Audited". Alert ON iff '
  'gad_revision_no > coalesce(bom_audited_gad_rev, bom_gad_baseline_rev).';

-- ---------------------------------------------------------------------
-- 3. Helper functions (atomic column-to-column updates supabase-js can't do).
-- ---------------------------------------------------------------------

-- Add a new GAD version: allocate next revision, flip prior current off, insert
-- the new current row, and mirror it onto jobs. Returns the new revision number.
create or replace function public.add_job_gad_version(
  p_job_id      uuid,
  p_path        text,
  p_url         text,
  p_filename    text,
  p_uploaded_by text
) returns integer
language plpgsql
as $$
declare
  v_rev integer;
begin
  select coalesce(max(revision_no), 0) + 1 into v_rev
    from public.job_gad_versions where job_id = p_job_id;

  update public.job_gad_versions set is_current = false
    where job_id = p_job_id and is_current;

  insert into public.job_gad_versions
    (job_id, revision_no, storage_path, url, filename, is_current, uploaded_by)
  values
    (p_job_id, v_rev, p_path, p_url, p_filename, true, coalesce(p_uploaded_by, 'unknown'));

  update public.jobs set
    gad_drawing_url         = p_url,
    gad_drawing_filename    = p_filename,
    gad_drawing_uploaded_at = now(),
    gad_revision_no         = v_rev,
    gad_uploaded_by         = coalesce(p_uploaded_by, 'unknown')
  where id = p_job_id;

  return v_rev;
end;
$$;
grant execute on function public.add_job_gad_version(uuid, text, text, text, text)
  to anon, authenticated, service_role;

-- Stamp "BOM defined" exactly once, snapshotting the live GAD revision as the
-- baseline. The bom_defined_at IS NULL guard makes it a one-time, race-free stamp.
create or replace function public.stamp_job_bom_defined(p_job_id uuid)
returns void
language sql
as $$
  update public.jobs
     set bom_defined_at       = now(),
         bom_gad_baseline_rev = gad_revision_no
   where id = p_job_id
     and bom_defined_at is null;
$$;
grant execute on function public.stamp_job_bom_defined(uuid)
  to anon, authenticated, service_role;

-- Mark the job's BOM audited (acknowledge the current GAD) or clear it.
create or replace function public.set_job_bom_audited(
  p_job_id  uuid,
  p_audited boolean,
  p_by      text
) returns void
language sql
as $$
  update public.jobs set
    bom_audited_at      = case when p_audited then now() else null end,
    bom_audited_by      = case when p_audited then coalesce(p_by, 'unknown') else null end,
    bom_audited_gad_rev = case when p_audited then gad_revision_no else null end
  where id = p_job_id;
$$;
grant execute on function public.set_job_bom_audited(uuid, boolean, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Backfill — baseline existing data so nothing alerts on day one.
-- ---------------------------------------------------------------------

-- 4a. Seed one v1 version row for every job that currently has a drawing.
insert into public.job_gad_versions
  (job_id, revision_no, storage_path, url, filename, is_current, uploaded_by, uploaded_at)
select
  id,
  1,
  regexp_replace(gad_drawing_url, '^.*/object/public/gad-drawings/', ''),
  gad_drawing_url,
  coalesce(gad_drawing_filename, 'gad'),
  true,
  'backfill',
  coalesce(gad_drawing_uploaded_at, now())
from public.jobs
where gad_drawing_url is not null
  and not exists (
    select 1 from public.job_gad_versions v where v.job_id = jobs.id
  );

-- 4b. Live revision = 1 where a GAD exists, else 0.
update public.jobs
   set gad_revision_no = case when gad_drawing_url is not null then 1 else 0 end;

-- 4c. Every existing job with >=1 Job BOM line is treated as defined AND already
--     audited at the current revision -> starts GREEN.
update public.jobs j set
  bom_defined_at       = coalesce(j.bom_defined_at, j.created_at, now()),
  bom_gad_baseline_rev = j.gad_revision_no,
  bom_audited_at       = now(),
  bom_audited_by       = 'backfill',
  bom_audited_gad_rev  = j.gad_revision_no
where exists (
  select 1
    from public.job_bom_headers h
    join public.job_bom_lines l on l.job_bom_id = h.id
   where h.job_id = j.id
);

-- 4d. Default identity columns for legacy rows.
update public.jobs
   set created_by      = coalesce(created_by, 'unknown'),
       gad_uploaded_by = coalesce(gad_uploaded_by, 'unknown');
