-- "Mark ready" for cabin jobs: a ready job's items stop counting toward the cabin
-- requirement / cutting demand (they're already built). Nullable timestamp =
-- reversible + auditable (NULL = not ready; non-NULL = ready, with when).
alter table cabin_jobs add column if not exists marked_ready_at timestamptz;

create index if not exists cabin_jobs_marked_ready_idx
  on cabin_jobs (id) where marked_ready_at is not null;
