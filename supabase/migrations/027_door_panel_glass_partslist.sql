-- GLASS-001 (6mm 1630x460 LV-900) door-panel parts lists.
--
-- Owner rule (2026-06-15): AT & CO doors, car + landing, LARGE-VISION (LV), 900 mm
-- opening, STD height use 2 x GLASS-001 per door. Each listed panel item is a whole
-- door (owner-confirmed), so qty = 2. Scope is large-vision std-height only:
--   * No-Vision (NV) doors have no glass window  -> not linked
--   * Medium/Small-Vision (MV/SV) use their own glass -> not linked
--   * BIG-height LV/900 doors use GLASS-002 (taller 1730 glass) -> not linked
--
-- Glass is trade (bought); panels are make door_panels. Modelling the glass as an
-- item_bom_lines child reclassifies GLASS-001 from "No link" -> "Formula" and, once
-- such a door is on a job, surfaces the glass demand in Trade MRP + Procurement via
-- getMrpData's includeDerivedTrade (same mechanism as the collapsible door shoes).
-- None of these 8 panels are on a live job today, so demand is 0 until one is ordered.
--
-- Idempotent: re-running adds nothing (guarded by NOT EXISTS on parent+child).

insert into item_bom_lines (parent_item_id, child_item_id, qty, finish_rule, sort_order)
select g.id, s.id, 2, 'neutral', 0
from items g
cross join (select id from items where code = 'GLASS-001') s
where g.code in (
  'DP-CP-AT-063','DP-CP-CO-076','DP-CP-CO-077','DP-CP-CO-078',
  'DP-LP-AT-066','DP-LP-CO-077','DP-LP-CO-078','DP-LP-CO-079'
)
and not exists (
  select 1 from item_bom_lines b where b.parent_item_id = g.id and b.child_item_id = s.id
);
