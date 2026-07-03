-- Add a backward-compatible p_stock filter to search_cabin_type so the Cabin
-- Inventory type pages can filter by stock state (like /inventory). Drop the old
-- 7-arg signature first so the new 8-arg (p_stock default null) is unambiguous;
-- existing callers that omit p_stock keep working via the default.
drop function if exists public.search_cabin_type(uuid, text, text, text, text, integer, integer);

create or replace function public.search_cabin_type(
  p_type_category_id uuid,
  p_search text default null,
  p_sub text default null,
  p_sort text default 'name',
  p_dir text default 'asc',
  p_limit integer default 100,
  p_offset integer default 0,
  p_stock text default null
)
returns table(id uuid, code text, name text, category_id uuid, sub_category_name text, stock_behaviour text, uom_abbreviation text, total_stock numeric, total_count bigint, in_stock_count bigint, type_total bigint)
language plpgsql
stable
as $function$
declare
  v_sort text;
  v_dir text;
  v_sql text;
begin
  v_sort := case lower(coalesce(p_sort,'name'))
              when 'code' then 'f.code'
              when 'stock' then 'f.total_stock'
              else 'f.name'
            end;
  v_dir := case when lower(coalesce(p_dir,'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sql := format($q$
    with recursive type_tree as (
      select id from item_categories where id = $1
      union all
      select c.id from item_categories c join type_tree tt on c.parent_id = tt.id
    ),
    type_total as (
      select count(*)::bigint n
        from items i
       where i.is_active
         and i.category_id in (select id from type_tree)
    ),
    base as (
      select i.id, i.code, i.name, i.category_id,
             c.name as sub_category_name,
             coalesce(i.stock_behaviour,'stocked') as stock_behaviour,
             u.abbreviation as uom_abbreviation,
             coalesce(inv.s, 0) as total_stock
      from items i
      left join item_categories c on c.id = i.category_id
      left join units_of_measurement u on u.id = i.uom_id
      left join lateral (select sum(quantity) s from inventory where item_id = i.id) inv on true
      where i.is_active
        and i.category_id in (select id from type_tree)
    ),
    filtered as (
      select * from base b
      where ($2 is null or b.sub_category_name = $2)
        and (
          $3 is null or trim($3) = '' or
          (select bool_and(
              b.name ilike '%%'||tok||'%%'
              or b.code ilike '%%'||tok||'%%'
              or coalesce(b.sub_category_name,'') ilike '%%'||tok||'%%')
           from unnest(string_to_array(lower(trim($3)), ' ')) as tok
           where tok <> '')
        )
        and (
          $6 is null or $6 = 'all'
          or ($6 = 'in_stock' and b.total_stock > 0)
          or ($6 = 'zero' and b.total_stock <= 0)
        )
    )
    select f.id, f.code, f.name, f.category_id, f.sub_category_name,
           f.stock_behaviour, f.uom_abbreviation, f.total_stock,
           count(*) over() as total_count,
           count(*) filter (where f.total_stock > 0) over() as in_stock_count,
           (select n from type_total) as type_total
    from filtered f
    order by %s %s nulls last, f.code asc
    limit $4 offset $5
  $q$, v_sort, v_dir);

  return query execute v_sql
    using p_type_category_id, p_sub, p_search, p_limit, p_offset, p_stock;
end;
$function$;