-- =====================================================================
-- 047: Job status-change alerting + audit history.
--
-- Sales/CRM mark a job's status (new / in_production / hold) per client
-- requirement + payment clearance, and the Factory must react. Today the
-- change is fire-and-forget — no record of who changed it, when, why, or
-- what it was before.
--
-- This migration adds an immutable audit log of EVERY status change
-- (from -> to, who, when, reason) and flags the four factory-critical
-- transitions as ALERTS that stay open until acknowledged:
--   new -> in_production           = 'started'
--   in_production -> hold          = 'held'      (reason required, app-side)
--   in_production -> new           = 'reverted'  (reason required, app-side)
--   hold -> in_production          = 'resumed'
--
-- Additive + backfilled: one baseline row per existing job (no alert) so
-- nothing lights up on day one — alerts only fire for changes AFTER this.
-- =====================================================================

create table if not exists public.job_status_changes (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  from_status     text,             -- null only for the backfilled initial row
  to_status       text not null,
  alert_kind      text check (alert_kind in ('started','held','reverted','resumed')), -- null = logged, not an alert
  reason          text,             -- app-required for 'held' / 'reverted'
  changed_by      text,             -- operator name (audit, not security)
  changed_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);

create index if not exists idx_jsc_job  on public.job_status_changes(job_id, changed_at desc);
-- Open alerts only (the sidebar count + alerts page hit this partial index).
create index if not exists idx_jsc_open on public.job_status_changes(acknowledged_at)
  where alert_kind is not null and acknowledged_at is null;

alter table public.job_status_changes enable row level security;
drop policy if exists "Allow all for anon" on public.job_status_changes;
create policy "Allow all for anon" on public.job_status_changes for all to anon using (true) with check (true);
grant all on public.job_status_changes to anon, authenticated, service_role;

-- Backfill: one baseline row per existing job (from_status null, no alert).
insert into public.job_status_changes (job_id, from_status, to_status, alert_kind, changed_by, changed_at)
select j.id, null, j.status, null, 'system (backfill)', coalesce(j.created_at, now())
from public.jobs j
where not exists (select 1 from public.job_status_changes c where c.job_id = j.id);
