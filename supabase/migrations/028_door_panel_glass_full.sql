-- Door-panel glass parts lists (GLASS-001..013) — 2 pieces per door.
--
-- Owner rules (2026-06-15): each Door-Panel-Glass SKU feeds AT & CO doors, car +
-- landing, by VISION × OPENING × HEIGHT. 2 pieces per door (each panel item is a
-- whole door). Glass is trade; panels are make door_panels -> the glass surfaces in
-- Trade MRP + Procurement via getMrpData's includeDerivedTrade once a door is on a
-- job (same mechanism as the collapsible door shoes / GLASS-001).
--
--   LV (large vision) glass is HEIGHT-specific:  std | big(2100) | 1900
--   MV (medium vision) glass covers std OR big (one SKU for both normal heights)
--
-- Height is encoded two ways in door names; both are handled:
--   * suffix (STD)/(BIG)              — newer panels
--   * /<height-mm>  e.g. /700/2100    — older (mostly Landing CO) panels: 2100=big,
--                                        2000/std default; 1900 = the short variant
--   * AT doors carry no height marker -> std (their default); "1900" when short.
-- (The 2000-vs-std call is moot here: no LV door uses /2000, and MV is std-or-big.)
--
-- Rule -> glass map:
--   GLASS-001 LV/900/std   GLASS-002 LV/900/big
--   GLASS-003 LV/800/std   GLASS-004 LV/800/big
--   GLASS-005 LV/750/std   GLASS-006 LV/700/std   GLASS-007 LV/700/big
--   GLASS-008 LV/700/1900  (no door SKU exists yet -> 0 links)
--   GLASS-009 LV/600/std
--   GLASS-010 MV/1000/sob  GLASS-011 MV/900/sob
--   GLASS-012 MV/800/sob   GLASS-013 MV/700/sob   (sob = std or big, excludes 1900)
--
-- NOT covered by any glass rule the owner gave (doors exist, no glass SKU): LV/1000,
-- MV/600, and the MV/700 1900-height variant — flagged for the owner.
--
-- Idempotent: re-running adds nothing (NOT EXISTS guard); GLASS-001's existing 8
-- links from migration 027 are skipped.

with rules(glass, vision, opening, htype) as (values
  ('GLASS-001','LV','900','std'), ('GLASS-002','LV','900','big'),
  ('GLASS-003','LV','800','std'), ('GLASS-004','LV','800','big'),
  ('GLASS-005','LV','750','std'), ('GLASS-006','LV','700','std'),
  ('GLASS-007','LV','700','big'), ('GLASS-008','LV','700','1900'),
  ('GLASS-009','LV','600','std'),
  ('GLASS-010','MV','1000','sob'), ('GLASS-011','MV','900','sob'),
  ('GLASS-012','MV','800','sob'), ('GLASS-013','MV','700','sob')
),
doors as (
  select i.id, i.name,
    case
      when i.name ~ '1900' then '1900'
      when i.name ~ '\(BIG\)' or i.name ~ '/2100' then 'big'
      when i.name ~ '\(STD\)' or i.name ~ '/2000' then 'std'
      else 'std' end as hclass
  from items i
  where i.category_id in (
    '85f8bc5e-3be8-435b-8eb6-56ed186b57e1', -- Car Door Pannel > Auto Telescopic
    '2855c427-87cc-4309-9ac6-a80b183f681e', -- Car Door Pannel > Centre Opening
    'cd49d45e-fc75-4707-b2a7-e5e8052f8a48', -- Landing Door Pannel > Auto Telescopic
    'dcdbb19d-1bf7-443a-b5a6-6d58eb809f0e'  -- Landing Door Pannel > Centre Opening
  )
)
insert into item_bom_lines (parent_item_id, child_item_id, qty, finish_rule, sort_order)
select d.id, g.id, 2, 'neutral', 0
from rules r
join doors d on d.name ~ ('/' || r.vision || '/' || r.opening)
  and ( (r.htype = 'std'  and d.hclass = 'std')
     or (r.htype = 'big'  and d.hclass = 'big')
     or (r.htype = '1900' and d.hclass = '1900')
     or (r.htype = 'sob'  and d.hclass in ('std','big')) )
join items g on g.code = r.glass
where not exists (
  select 1 from item_bom_lines b where b.parent_item_id = d.id and b.child_item_id = g.id
);
