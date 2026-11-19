-- 078 — single-query replacements for MRP's two big paged reads.
--
-- Additive only: two new STABLE read functions, no table or data changes.
-- They return the SAME raw rows/sums the app used to page for; all MRP rules
-- (stage scope, dispatch netting, demand folds) stay in the app, untouched.
-- The app falls back to its original paged reads if a call fails.
--
-- Why: a cold MRP load paged ~29,000 job BOM lines (30 requests, each carrying
-- ~330 header ids in the URL) and ~17,000 dispatch lines (18 requests).

-- 1) In-scope job BOM lines for a set of BOM headers. Compact rows:
--    [id, item_id, required_quantity, job_bom_id, category, dispatch_phase]
--    Same filter as the paged read: item mapped and required_quantity > 0.
create or replace function public.erp_mrp_bom_lines(p_header_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
    l.id, l.item_id, l.required_quantity, l.job_bom_id, l.category, l.dispatch_phase
  ) order by l.id), '[]'::jsonb)
  from job_bom_lines l
  where l.job_bom_id = any (p_header_ids)
    and l.item_id is not null
    and l.required_quantity > 0
$$;

-- 2) Dispatched-so-far per BOM line across the whole table: { line_id: qty }.
--    Ad-hoc dispatch lines (no BOM line) are excluded, as before.
create or replace function public.erp_dispatched_qty_by_bom_line()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.job_bom_line_id, t.qty), '{}'::jsonb)
  from (
    select dl.job_bom_line_id, sum(coalesce(dl.qty, 0)) as qty
    from job_dispatch_lines dl
    where dl.job_bom_line_id is not null
    group by dl.job_bom_line_id
  ) t
$$;

grant execute on function public.erp_mrp_bom_lines(uuid[]) to anon, authenticated, service_role;
grant execute on function public.erp_dispatched_qty_by_bom_line() to anon, authenticated, service_role;
