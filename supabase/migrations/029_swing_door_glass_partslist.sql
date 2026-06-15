-- GLASS-014 (8mm 1825x665 Swing Door Glass) parts list.
--
-- Owner rule (2026-06-15): Swing Door, 700 mm opening, both LH + RH, all finishes,
-- LARGE-VISION (LV) -> 1 piece per door (a swing door is a single leaf = one vision
-- pane; owner-confirmed qty 1, LV-only).
--
-- Excludes the Ecospace (ECO) LV/700 door (SA-CT-102): it uses the narrower
-- GLASS-017 (1825x545 Ecospace Swing Door Glass), which the owner left "No link" —
-- so the 665 mm glass must not be linked to it. Swing-door panels are make
-- (mechanical_finished_stock), glass is trade -> the glass surfaces in Trade MRP +
-- Procurement via getMrpData's includeDerivedTrade once a swing door is on a job.
--
-- Idempotent: re-running adds nothing (NOT EXISTS guard).

insert into item_bom_lines (parent_item_id, child_item_id, qty, finish_rule, sort_order)
select d.id, g.id, 1, 'neutral', 0
from items d
cross join (select id from items where code = 'GLASS-014') g
where d.category_id = '70b23ca2-e233-4aa6-8ba0-a6c982a6980c' -- Swing Door > Swing Door
  and d.name ~ '/700/' and d.name ~ '/LV' and d.name !~ 'ECO'
  and not exists (
    select 1 from item_bom_lines b where b.parent_item_id = d.id and b.child_item_id = g.id
  );
