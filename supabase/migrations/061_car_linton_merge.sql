-- 061 — Car Linton catalog merge (regular inventory -> cabin)
--
-- The owner wants "Car Linton" to live ONLY under the Cabin section. Regular
-- inventory holds a SECOND modelling of the same physical part: 83 items coded
-- SA-HD-###, in categories "<door> Linton Pannel Car" (ACO/AT/AFF/MT). They are
-- absent from Cabin Jobs and Packing List R1; their only ties are 14 units of
-- stock (8 items), 46 CNC "Car Door Panel" program outputs (43 items), and
-- 4 legacy Job-Order BOM lines + 1 dispatch line.
--
-- Owner's disambiguation rules make the regular->cabin map deterministic:
--   * default variant STD (never R1/BIG)
--   * plain "SS" means grade "SS 430"
--   * door token ACO->CO, AT->SO, AFF->AFF, MT->MT; opening size preserved;
--     a named finish (Rose Gold, Mirror, ...) maps to that finish under STD.
-- 65 of 83 resolve to a unique cabin twin (62 distinct twins); the other 18 are
-- dead padding (0 stock / 0 programs / 0 refs) that cabin doesn't carry.
--
-- Full merge: transfer stock to the twin, re-point every reference to the twin,
-- then soft-delete (deactivate) all 83 regular items. Pure data change; a full
-- backup table is written first so the whole operation is reversible.
--
-- Pre-verified (read-only) before writing: data_items_without_twin = 0,
-- program_output_collisions = 0, within_program_collisions = 0,
-- twins_already_in_cabin_programs = 0. No balance trigger on
-- inventory_transactions, so balances are updated manually + ledger rows written.

-- ---------------------------------------------------------------------------
-- Step 0 — snapshot every affected item + its references (rollback safety)
-- ---------------------------------------------------------------------------
create table if not exists public.car_linton_merge_backup (
  reg_id        uuid primary key,
  code          text,
  name          text,
  twin_id       uuid,
  twin_code     text,
  was_active    boolean,
  inv_snapshot  jsonb,
  oo_snapshot   jsonb,
  bom_snapshot  jsonb,
  disp_snapshot jsonb,
  created_at    timestamptz default now()
);

with car as (
  select i.id, i.code, i.name, i.is_active, c.name as reg_cat
  from items i join item_categories c on c.id = i.category_id
  where c.name ilike '%Linton Pannel Car%'
),
parsed as (
  select *,
    case when reg_cat ilike 'ACO%' then 'CO' when reg_cat ilike 'AT%'  then 'SO'
         when reg_cat ilike 'AFF%' then 'AFF' when reg_cat ilike 'MT%' then 'MT' end as cd,
    (substring(name from '/(\d{3,4})'))::int as sz,
    case when name ilike '%MS/%' then 'MS'
         when name ~ '\(([^)]+)\)' then trim(substring(name from '\(([^)]+)\)'))
         else 'SS430' end as fin
  from car
),
matched as (
  select p.*, case
      when cd='AFF' and fin='MS' then '%AFF '||sz||' CAR LINTON MS'
      when cd='AFF'              then '%AFF '||sz||' CAR LINTON SS 430'
      when fin='MS'              then '% '||cd||' MS/'||sz||'mm STD'
      when fin='SS430'           then '% '||cd||' SS 430/'||sz||'mm STD'
      else '% '||cd||' SS/'||sz||'mm STD ('||fin||')' end as pat
  from parsed p
),
map as (
  select m.id as reg_id, m.code, m.name, m.is_active as was_active,
         t.id as twin_id, t.code as twin_code
  from matched m
  left join lateral (
    select ci.id, ci.code
    from items ci
    join item_categories cc on cc.id = ci.category_id
    join item_categories pp on pp.id = cc.parent_id and pp.name = 'Car Linton'
    where ci.name ilike m.pat
    limit 1
  ) t on true
)
insert into public.car_linton_merge_backup
  (reg_id, code, name, twin_id, twin_code, was_active,
   inv_snapshot, oo_snapshot, bom_snapshot, disp_snapshot)
select map.reg_id, map.code, map.name, map.twin_id, map.twin_code, map.was_active,
  (select jsonb_agg(to_jsonb(v)) from inventory v          where v.item_id = map.reg_id),
  (select jsonb_agg(to_jsonb(o)) from operation_outputs o  where o.item_id = map.reg_id),
  (select jsonb_agg(to_jsonb(b)) from job_bom_lines b      where b.item_id = map.reg_id),
  (select jsonb_agg(to_jsonb(d)) from job_dispatch_lines d where d.item_id = map.reg_id)
from map;

-- ---------------------------------------------------------------------------
-- Step 1 — stock transfer (8 items / 14 units) reg -> twin, net conserved
-- ---------------------------------------------------------------------------
-- 1a. Ensure a twin inventory row exists in each warehouse that holds reg stock.
insert into inventory (item_id, warehouse_id, quantity)
select distinct b.twin_id, v.warehouse_id, 0
from car_linton_merge_backup b
join inventory v on v.item_id = b.reg_id and v.quantity <> 0
where b.twin_id is not null
  and not exists (
    select 1 from inventory tw
    where tw.item_id = b.twin_id and tw.warehouse_id = v.warehouse_id
  );

-- 1b. Add the reg quantity onto the twin (per warehouse).
update inventory tw
set quantity = tw.quantity + agg.q, updated_at = now()
from (
  select b.twin_id, v.warehouse_id, sum(v.quantity) as q
  from car_linton_merge_backup b
  join inventory v on v.item_id = b.reg_id and v.quantity <> 0
  where b.twin_id is not null
  group by b.twin_id, v.warehouse_id
) agg
where tw.item_id = agg.twin_id and tw.warehouse_id = agg.warehouse_id;

-- 1c. Ledger rows (adjustment is signed: +q on twin, -q on reg). Reg still holds
--     its original quantity here (zeroed in 1d), so v.quantity is the moved amount.
insert into inventory_transactions
  (item_id, warehouse_id, transaction_type, quantity, reference_type, notes, created_by_name)
select b.twin_id, v.warehouse_id, 'adjustment', v.quantity, 'car_linton_merge',
       'Car Linton merge: received ' || v.quantity || ' from ' || b.code, 'Car Linton merge'
from car_linton_merge_backup b
join inventory v on v.item_id = b.reg_id and v.quantity <> 0
where b.twin_id is not null;

insert into inventory_transactions
  (item_id, warehouse_id, transaction_type, quantity, reference_type, notes, created_by_name)
select b.reg_id, v.warehouse_id, 'adjustment', -v.quantity, 'car_linton_merge',
       'Car Linton merge: moved ' || v.quantity || ' to twin ' || b.twin_code, 'Car Linton merge'
from car_linton_merge_backup b
join inventory v on v.item_id = b.reg_id and v.quantity <> 0
where b.twin_id is not null;

-- 1d. Zero out the reg inventory balances.
update inventory v
set quantity = 0, updated_at = now()
from car_linton_merge_backup b
where v.item_id = b.reg_id and v.quantity <> 0 and b.twin_id is not null;

-- ---------------------------------------------------------------------------
-- Step 2 — re-point every reference from reg -> twin (mapped items only)
-- ---------------------------------------------------------------------------
update operation_outputs o
set item_id = b.twin_id
from car_linton_merge_backup b
where o.item_id = b.reg_id and b.twin_id is not null;      -- 46 lines / 43 items

update job_bom_lines l
set item_id = b.twin_id
from car_linton_merge_backup b
where l.item_id = b.reg_id and b.twin_id is not null;      -- 4 lines

update job_dispatch_lines d
set item_id = b.twin_id
from car_linton_merge_backup b
where d.item_id = b.reg_id and b.twin_id is not null;      -- 1 line

-- ---------------------------------------------------------------------------
-- Step 3 — retire all 83 regular items (soft delete; category unchanged)
-- ---------------------------------------------------------------------------
update items i
set is_active = false, updated_at = now()
from car_linton_merge_backup b
where i.id = b.reg_id;
