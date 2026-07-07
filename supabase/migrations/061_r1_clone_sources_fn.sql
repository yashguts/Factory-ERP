-- Aggregate source-list picker for the "Clone Packing List R1 from another job"
-- feature. Returns one row per existing R1 list with its filled-line count, so
-- the factory team can pick an already-filled identical job to copy from.
-- Server-side aggregation avoids pulling ~37k line rows to the app.
create or replace function public.r1_clone_sources()
returns table (
  job_id uuid,
  job_number text,
  customer_name text,
  status text,
  filled_lines bigint,
  total_lines bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.job_id,
    j.job_number,
    j.customer_name,
    l.status,
    count(pl.id) filter (where pl.item_id is not null) as filled_lines,
    count(pl.id) as total_lines,
    l.updated_at
  from packing_r1_lists l
  join jobs j on j.id = l.job_id
  left join packing_r1_lines pl on pl.list_id = l.id
  group by l.job_id, j.job_number, j.customer_name, l.status, l.updated_at;
$$;

grant execute on function public.r1_clone_sources() to anon, authenticated, service_role;
