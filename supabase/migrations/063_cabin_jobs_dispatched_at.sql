-- Cabin jobs get a "dispatched" status (owner, 2026-07-07): mark a cabin job
-- dispatched to move it out of the active list into a Dispatched section. This is
-- a STATUS ONLY — no inventory effect (cabin stock is consumed on 'ready', not on
-- dispatch). Mirrors marked_ready_at.
alter table public.cabin_jobs
  add column if not exists dispatched_at timestamptz;
