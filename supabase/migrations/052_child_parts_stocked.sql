-- Stage 1 of the Child Parts / assembly-gap work.
--
-- Child parts (loose pieces a program cuts, which then get assembled into a
-- sub-assembly) were modelled as `phantom` = "never stocked by design". The
-- owner now wants them tracked as real inventory so the cut->assemble->dispatch
-- chain closes. This reclassifies every phantom that is a CHILD of a
-- sub-assembly (a row in item_bom_lines) to `stocked`, and backfills the loose
-- pieces that the post-cutover program runs already cut but never posted.
--
-- Idempotent: the reclassify only touches rows still phantom; the backfill is
-- guarded by NOT EXISTS on (program_run, item) so re-running posts nothing new.

begin;

-- 1. Child parts become real, stockable items.
update items
   set stock_behaviour = 'stocked', updated_at = now()
 where stock_behaviour = 'phantom'
   and id in (select distinct child_item_id from item_bom_lines where child_item_id is not null);

-- 2. Backfill: program runs dated on/after the cutover already cut some of these
--    parts, but cut_part outputs were skipped at the time. Post them now, exactly
--    as recordTransaction would (production_in into Main Store), keyed by run id
--    so the app's delta-reconcile stays consistent.
create temp table _cp_backfill on commit drop as
with main as (select id from warehouses where name = 'Main Store')
select r.id                                as run_id,
       o.item_id,
       (select id from main)               as wh,
       sum(o.qty_per_run) * r.runs_count   as qty
  from operation_runs r
  join operation_outputs o
    on o.operation_id = r.operation_id and o.role = 'cut_part' and o.item_id is not null
  join items i
    on i.id = o.item_id and i.stock_behaviour = 'stocked'
 where r.run_date >= '2026-06-30'
   and o.item_id in (select distinct child_item_id from item_bom_lines where child_item_id is not null)
   and not exists (
     select 1 from inventory_transactions t
      where t.reference_type = 'program_run' and t.reference_id = r.id and t.item_id = o.item_id
   )
 group by r.id, o.item_id;

insert into inventory_transactions
       (item_id, warehouse_id, transaction_type, quantity, reference_type, reference_id, notes, created_by_name)
select item_id, wh, 'production_in', qty, 'program_run', run_id,
       'Child-part stocking backfill (Stage 1 cutover)', 'System (backfill)'
  from _cp_backfill;

update inventory inv
   set quantity = inv.quantity + agg.qty
  from (select item_id, wh, sum(qty) qty from _cp_backfill group by item_id, wh) agg
 where inv.item_id = agg.item_id and inv.warehouse_id = agg.wh;

insert into inventory (item_id, warehouse_id, quantity)
select agg.item_id, agg.wh, agg.qty
  from (select item_id, wh, sum(qty) qty from _cp_backfill group by item_id, wh) agg
 where not exists (
   select 1 from inventory inv where inv.item_id = agg.item_id and inv.warehouse_id = agg.wh
 );

commit;
