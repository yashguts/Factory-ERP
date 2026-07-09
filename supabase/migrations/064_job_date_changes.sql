-- =====================================================================
-- 064: Req. Dispatch Date change audit — with a MANDATORY reason.
--
-- The office moves jobs' requirement_dispatch_date to manage the dispatch
-- plan, but until now a date could silently slide with no record of who
-- moved it, when, or why. Per management: a dispatch-date change without a
-- written reason is not allowed.
--
-- This adds an immutable log of every requirement_dispatch_date change
-- (from -> to, who, when, WHY). The reason is NOT NULL here — unlike
-- job_status_changes.reason, the DB itself refuses an unreasoned change.
-- The app (updateJob) enforces the same rule before writing and blocks the
-- date update entirely when no reason is given. Initial date set at job
-- creation is not a "change" and is not logged.
-- =====================================================================

create table if not exists public.job_date_changes (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  from_date   date,              -- null when the date was previously unset
  to_date     date,              -- null when the date is being cleared
  reason      text not null,     -- mandatory — the whole point of this table
  changed_by  text,              -- operator name (audit, not security)
  changed_at  timestamptz not null default now()
);

create index if not exists idx_jdc_job on public.job_date_changes(job_id, changed_at desc);

alter table public.job_date_changes enable row level security;
drop policy if exists "Allow all for anon" on public.job_date_changes;
create policy "Allow all for anon" on public.job_date_changes for all to anon using (true) with check (true);
grant all on public.job_date_changes to anon, authenticated, service_role;
