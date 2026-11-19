-- 077 — single-query replacements for three reads that paged whole tables.
--
-- Additive only: three new STABLE read functions, no table or data changes.
-- Each returns ONE jsonb value (not a row set) so PostgREST's 1000-row cap can
-- never truncate the answer. The app calls these first and falls back to its
-- original paged reads if a call fails, so behaviour is unchanged either way.
--
-- Why: the website server is in Singapore and the database in Mumbai, so every
-- request carries a fixed delay. With ~32,800 items, getItemRefs and the R1
-- category counts each fired ~33 requests per cache miss, and the jobs-list
-- dispatch badge sent two reads with ~450 ids in the URL (0.4–0.6 s each).

-- 1) DISTINCT (item_type, category_id) over active items — getItemRefs.
--    Cabin-subtree filtering stays in the app, exactly as before.
create or replace function public.erp_item_type_category_pairs()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_type', t.item_type, 'category_id', t.category_id)), '[]'::jsonb)
  from (
    select distinct i.item_type, i.category_id
    from items i
    where i.is_active = true
  ) t
$$;

-- 2) Active-item count per DIRECT category — R1 category item counts.
--    Subtree roll-up stays in the app, exactly as before.
create or replace function public.erp_active_item_counts_by_category()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.category_id, t.n), '{}'::jsonb)
  from (
    select i.category_id, count(*) as n
    from items i
    where i.is_active = true and i.category_id is not null
    group by i.category_id
  ) t
$$;

-- 3) Per-job dispatch status (partial / full) — jobs-list Dispatch badge.
--    Mirrors _getJobsDispatchStatusUncached line for line:
--      * only jobs with at least one dispatch are returned (others = "none");
--      * BOM lines counted are those with a non-null category;
--      * sent qty per BOM line sums dispatch lines of THESE jobs' dispatches;
--      * a line is open when required − sent > 0.0001;
--      * a job with no BOM lines is "full" only if it has an "entire job"
--        (phase_scope = 'full') dispatch, else "partial".
create or replace function public.erp_jobs_dispatch_status(p_job_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  with disp as (
    select d.id, d.job_id, d.phase_scope
    from job_dispatches d
    where d.job_id = any (p_job_ids)
  ),
  dj as (
    select job_id, bool_or(phase_scope = 'full') as has_full
    from disp
    group by job_id
  ),
  sent as (
    select dl.job_bom_line_id as line_id, sum(dl.qty) as qty
    from job_dispatch_lines dl
    join disp on disp.id = dl.dispatch_id
    where dl.job_bom_line_id is not null
    group by dl.job_bom_line_id
  ),
  ln as (
    select h.job_id,
           bool_or(coalesce(l.required_quantity, 0) - coalesce(s.qty, 0) > 0.0001) as has_open
    from job_bom_headers h
    join job_bom_lines l on l.job_bom_id = h.id
    left join sent s on s.line_id = l.id
    where h.job_id in (select job_id from dj)
      and l.category is not null
    group by h.job_id
  )
  select coalesce(jsonb_object_agg(
    dj.job_id,
    case
      when ln.job_id is null then case when dj.has_full then 'full' else 'partial' end
      when ln.has_open then 'partial'
      else 'full'
    end
  ), '{}'::jsonb)
  from dj
  left join ln on ln.job_id = dj.job_id
$$;

grant execute on function public.erp_item_type_category_pairs() to anon, authenticated, service_role;
grant execute on function public.erp_active_item_counts_by_category() to anon, authenticated, service_role;
grant execute on function public.erp_jobs_dispatch_status(uuid[]) to anon, authenticated, service_role;
