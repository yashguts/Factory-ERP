-- 018: search_inventory learns demand-source classification + Make/Trade filter.
--
-- Adds three DEFAULTED params (so the currently-deployed app's old named-arg
-- calls keep resolving during the deploy window) and one new return column:
--
--   p_procurement        'make' | 'trade' | null  → filter by effective M/T
--   p_demand             'jobs' | 'formula' | 'none' | 'tooling' | null
--   p_bound_category_ids category ids (incl. descendants) bound to job-form
--                        BOM sections — resolved app-side from BOM_SECTIONS,
--                        since that list lives in TypeScript.
--
--   demand_source: how an item gets its material requirement.
--     'tooling' — stock_behaviour = tooling: not planned, by design
--     'jobs'    — independent demand: category is pickable on the job form,
--                 or the item already appears on a job BOM line
--     'formula' — dependent demand: consumed by a program (operation_inputs)
--                 or a child in an item parts list (item_bom_lines)
--     'none'    — no path to demand at all (the action list)
--
-- DROP + CREATE (not OR REPLACE) because the RETURNS TABLE shape changes.
-- Same name, no overload — two candidates would make PostgREST named-arg
-- resolution ambiguous and break the live app.
--
-- Supporting indexes (job_bom_lines.item_id, operation_inputs.item_id,
-- item_bom_lines.child_item_id) already exist — verified before this migration.

drop function if exists public.search_inventory(
  text, text, uuid[], text, text, text, text, integer, integer);

create function public.search_inventory(
  p_search text default null,
  p_type text default null,
  p_category_ids uuid[] default null,
  p_stock text default null,
  p_behaviour text default null,
  p_sort text default 'code',
  p_dir text default 'asc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_procurement text default null,
  p_demand text default null,
  p_bound_category_ids uuid[] default null
)
returns table(
  id uuid,
  code text,
  name text,
  description text,
  item_type text,
  category_id uuid,
  category_name text,
  uom_abbreviation text,
  total_stock numeric,
  reorder_point numeric,
  cost_price numeric,
  stock_behaviour text,
  effective_procurement_type text,
  demand_source text,
  total_count bigint
)
language plpgsql
stable
as $function$
declare
  v_sort text;
  v_dir text;
  v_sql text;
begin
  v_sort := case lower(coalesce(p_sort,'code'))
              when 'name' then 'f.name'
              when 'stock' then 'f.total_stock'
              when 'category' then 'f.category_name'
              when 'cost' then 'f.cost_price'
              else 'f.code'
            end;
  v_dir := case when lower(coalesce(p_dir,'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sql := format($q$
    with recursive cabin as (
      select id from item_categories where name = 'Cabin' and parent_id is null
      union all
      select c.id from item_categories c join cabin on c.parent_id = cabin.id
    ),
    base as (
      select i.id, i.code, i.name, i.description, i.item_type::text as item_type, i.category_id,
             c.name as category_name,
             u.abbreviation as uom_abbreviation,
             coalesce(inv.s, 0) as total_stock,
             i.reorder_point, i.cost_price,
             coalesce(i.stock_behaviour,'stocked') as stock_behaviour,
             coalesce(i.procurement_type, c.procurement_type) as effective_procurement_type,
             case
               when coalesce(i.stock_behaviour,'stocked') = 'tooling' then 'tooling'
               when i.category_id = any($8)
                    or exists (select 1 from job_bom_lines b where b.item_id = i.id) then 'jobs'
               when exists (select 1 from operation_inputs oi where oi.item_id = i.id)
                    or exists (select 1 from item_bom_lines ib where ib.child_item_id = i.id) then 'formula'
               else 'none'
             end as demand_source
      from items i
      left join item_categories c on c.id = i.category_id
      left join units_of_measurement u on u.id = i.uom_id
      left join lateral (select sum(quantity) s from inventory where item_id = i.id) inv on true
      where i.is_active
        and (i.category_id is null or i.category_id not in (select id from cabin))
        and ($1 is null or i.item_type::text = $1)
        and ($2 is null or i.category_id = any($2))
        and (
          case
            when $3 = 'stocked' then coalesce(i.stock_behaviour,'stocked') = 'stocked'
            when $3 in ('phantom','tooling') then i.stock_behaviour = $3
            else coalesce(i.stock_behaviour,'stocked') <> 'phantom'
          end
        )
        and (
          $4 is null or trim($4) = '' or
          (select bool_and(
              i.name ilike '%%'||tok||'%%'
              or coalesce(i.lookup_key,'') ilike '%%'||tok||'%%'
              or i.code ilike '%%'||tok||'%%'
              or coalesce(i.description,'') ilike '%%'||tok||'%%')
           from unnest(string_to_array(lower(trim($4)), ' ')) as tok
           where tok <> '')
        )
    ),
    filtered as (
      select * from base
      where case
              when $5 = 'low' then total_stock <= reorder_point and reorder_point > 0
              when $5 = 'zero' then total_stock = 0
              when $5 = 'in_stock' then total_stock > 0
              else true
            end
        and ($9 is null or effective_procurement_type = $9)
        and ($10 is null or demand_source = $10)
    )
    select f.id, f.code, f.name, f.description, f.item_type, f.category_id, f.category_name,
           f.uom_abbreviation, f.total_stock, f.reorder_point, f.cost_price,
           f.stock_behaviour, f.effective_procurement_type, f.demand_source,
           count(*) over() as total_count
    from filtered f
    order by %s %s nulls last, f.code asc
    limit $6 offset $7
  $q$, v_sort, v_dir);

  return query execute v_sql
    using p_type, p_category_ids, p_behaviour, p_search, p_stock, p_limit, p_offset,
          p_bound_category_ids, p_procurement, p_demand;
end;
$function$;

grant execute on function public.search_inventory(
  text, text, uuid[], text, text, text, text, integer, integer, text, text, uuid[])
  to anon, authenticated, service_role;
