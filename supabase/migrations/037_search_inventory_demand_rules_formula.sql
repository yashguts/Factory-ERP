-- 037 — count item_demand_rules as "formula" in the demand classifier
--
-- search_inventory() classified an item's demand_source as 'formula' only if it
-- was a program input or an item_bom_lines child. It ignored item_demand_rules,
-- so an item whose demand comes from a component rule (e.g. "4 guide shoes per
-- safety frame") still showed as 'none' — and would never leave the Demand Rules
-- "needs a formula" list after you defined one. This adds the missing condition.
-- Only the 'formula' CASE branch changed (one extra EXISTS on item_demand_rules).
CREATE OR REPLACE FUNCTION public.search_inventory(p_search text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_category_ids uuid[] DEFAULT NULL::uuid[], p_stock text DEFAULT NULL::text, p_behaviour text DEFAULT NULL::text, p_sort text DEFAULT 'code'::text, p_dir text DEFAULT 'asc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_procurement text DEFAULT NULL::text, p_demand text DEFAULT NULL::text, p_bound_category_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, code text, name text, description text, item_type text, category_id uuid, category_name text, uom_abbreviation text, total_stock numeric, reorder_point numeric, cost_price numeric, stock_behaviour text, effective_procurement_type text, demand_source text, demand_overridden boolean, total_count bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
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
             coalesce(
               i.demand_override,
               case
                 when coalesce(i.stock_behaviour,'stocked') = 'tooling' then 'tooling'
                 when i.category_id = any($8)
                      or exists (select 1 from job_bom_lines b where b.item_id = i.id) then 'jobs'
                 when exists (select 1 from operation_inputs oi where oi.item_id = i.id)
                      or exists (select 1 from item_bom_lines ib where ib.child_item_id = i.id)
                      or exists (select 1 from item_demand_rules dr where dr.child_item_id = i.id) then 'formula'
                 else 'none'
               end
             ) as demand_source,
             (i.demand_override is not null) as demand_overridden
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
           f.stock_behaviour, f.effective_procurement_type, f.demand_source, f.demand_overridden,
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
