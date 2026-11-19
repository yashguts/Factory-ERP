-- =====================================================================
-- 079: CRM drawing / SMR lock — the Factory ERP side.
--
-- Why. Owner rule (19 Nov 2026): once a job is in the Factory ERP the
-- factory is building against its drawing and site measurement report
-- (SMR), so its CRM (LT Elevator CRM or Ricardo CRM, picked by the
-- job-number format) must refuse every drawing / SMR change for that job
-- until the factory presses "Release job" here. Releasing puts the ERP job
-- on Hold (mandatory reason) and unlocks the CRM; "Lock again" re-locks it.
--
-- The lock itself lives in each CRM (table erp_job_locks + a guard trigger,
-- written only through the secret-gated RPC erp_set_job_locks). This
-- migration only gives the ERP somewhere to remember what it told the CRM:
--
--   a. jobs.crm_lock_state + the release stamp columns.
--        pending  = should be locked, but the CRM has not confirmed it yet
--                   (CRM unreachable / job not found there). The UI offers
--                   "Lock now". This is the default, so a job created by any
--                   path is never silently treated as locked.
--        locked   = the CRM confirmed the lock.
--        released = the factory released it; the CRM can change drawing/SMR.
--        na       = the job number belongs to neither CRM — nothing to lock.
--   b. Existing jobs whose number resolves to no CRM key are set to 'na'
--      (cx_job_key_of implements the same grammar as the app's ltCrmKeyOf /
--      ricardoKeyOf). Every other existing job stays 'pending' until the
--      one-off backfill locks it in its CRM.
--   c. job_crm_lock_events — who locked / released what, when, why, and
--      whether the CRM call succeeded (failed attempts are kept too).
--
-- Additive and rerunnable. No existing column, function or policy changes.
-- =====================================================================

-- a. lock state on the job -------------------------------------------------
alter table public.jobs
  add column if not exists crm_lock_state     text not null default 'pending',
  add column if not exists crm_lock_synced_at timestamptz,
  add column if not exists crm_released_at    timestamptz,
  add column if not exists crm_released_by    text,
  add column if not exists crm_release_reason text;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'jobs_crm_lock_state_check' and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_crm_lock_state_check
      check (crm_lock_state in ('pending', 'locked', 'released', 'na'));
  end if;
end
$do$;

comment on column public.jobs.crm_lock_state is
  'CRM drawing/SMR lock as the ERP last knew it: pending (should be locked, CRM not confirmed) | locked (CRM confirmed) | released (factory released, CRM unlocked) | na (not a CRM job number).';
comment on column public.jobs.crm_lock_synced_at is
  'When the CRM last confirmed a lock or release for this job.';
comment on column public.jobs.crm_released_at is
  'When the job was last released to the CRM. Kept after "Lock again" as history.';
comment on column public.jobs.crm_released_by is
  'Operator who last released the job to the CRM (audit name, not security).';
comment on column public.jobs.crm_release_reason is
  'Mandatory reason given for the last release to the CRM.';

-- b. numbers that belong to neither CRM have nothing to lock ---------------
update public.jobs
   set crm_lock_state = 'na'
 where crm_lock_state = 'pending'
   and public.cx_job_key_of(job_number) is null;

-- c. audit trail -----------------------------------------------------------
create table if not exists public.job_crm_lock_events (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  action        text not null check (action in ('lock', 'release')),
  reason        text,                 -- mandatory for a release (enforced by the app)
  performed_by  text,                 -- operator name (audit, not security)
  performed_at  timestamptz not null default now(),
  crm           text,                 -- 'LT Elevator CRM' | 'Ricardo CRM' | null (not a CRM number)
  ok            boolean not null,     -- false = the attempt failed; nothing changed in the CRM
  detail        text                  -- CRM answer / failure message
);

comment on table public.job_crm_lock_events is
  'Every attempt to lock or release a job''s drawings + SMR in its CRM (079). ok = false rows are failed attempts, kept so a job stuck on "pending" can be explained.';

create index if not exists idx_jcle_job on public.job_crm_lock_events(job_id, performed_at desc);

alter table public.job_crm_lock_events enable row level security;
drop policy if exists "Allow all for anon" on public.job_crm_lock_events;
create policy "Allow all for anon" on public.job_crm_lock_events for all to anon using (true) with check (true);
grant all on public.job_crm_lock_events to anon, authenticated, service_role;
