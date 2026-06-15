-- Collapsible gate -> door-shoe parts lists (item_bom_lines).
--
-- Engineering rule (owner, 2026-06-15): a collapsible gate is built from a fixed
-- number of cast-iron / PVC door shoes, banded by channel count:
--   * Gates  6+1 .. 9+1 channels  -> 7  x DS-003 (Collapsible Door Shoe PVC)
--   * Gates 10+1 .. 24+1 channels -> 15 x DS-002 (Collapsible Door Shoe C.I)
-- Sizes outside 6+1..24+1 (5+1 and 26/28/30+1) are intentionally left unlinked
-- for now (no current orders; owner will specify if/when needed).
--
-- The gates are made-in-house door_panel items; the shoes are purchased (trade).
-- Modelling them as item_bom_lines children (a) reclassifies the shoes from
-- "No link" -> "Formula" in the inventory Demand column, (b) makes the gate demand
-- explode into shoe demand in /mrp/plan's purchased list, and (c) — together with
-- the matching getMrpData change — surfaces the shoes on the MRP Trade tab and in
-- Procurement. finish_rule = 'neutral' (a concrete child, no finish dimension).
--
-- Idempotent: re-running adds nothing (guarded by NOT EXISTS on parent+child).

-- 15 x DS-002 (C.I) for gates 10+1 .. 24+1 (incl. the 14+1(2500) and 20+1 OPP 2500 variants)
insert into item_bom_lines (parent_item_id, child_item_id, qty, finish_rule, sort_order)
select g.id, s.id, 15, 'neutral', 0
from items g
cross join (select id from items where code = 'DS-002') s
where g.code in (
  'DP-CD-CD-006','DP-CD-CD-007','DP-CD-CD-008','DP-CD-CD-009','DP-CD-CD-010',
  'DP-CD-CD-011','DP-CD-CD-012','DP-CD-CD-013','DP-CD-CD-014','DP-CD-CD-015',
  'DP-CD-CD-016','DP-CD-CD-017','DP-CD-CD-018','DP-CD-CD-019','DP-CD-CD-020',
  'DP-CD-CD-021','DP-CD-CD-025'
)
and not exists (
  select 1 from item_bom_lines b where b.parent_item_id = g.id and b.child_item_id = s.id
);

-- 7 x DS-003 (PVC) for gates 6+1 .. 9+1
insert into item_bom_lines (parent_item_id, child_item_id, qty, finish_rule, sort_order)
select g.id, s.id, 7, 'neutral', 0
from items g
cross join (select id from items where code = 'DS-003') s
where g.code in ('DP-CD-CD-002','DP-CD-CD-003','DP-CD-CD-004','DP-CD-CD-005')
and not exists (
  select 1 from item_bom_lines b where b.parent_item_id = g.id and b.child_item_id = s.id
);
