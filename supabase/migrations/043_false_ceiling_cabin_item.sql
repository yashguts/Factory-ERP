-- False Ceiling — a new finish-family CABIN item.
--
-- Picked inside a Cabin Job via the two-step base->finish picker (family =
-- 'False Ceiling'), it flows into the part list's "Cabin Panels (from Cabin Job)"
-- block. Its size auto-derives from the job's Platform (W-50 x D-50) in
-- partlist-generate.ts. Registered as a cabin type in src/lib/cabin/cabin-types.ts
-- (CABIN_TYPES + FINISH_SPLIT_INVENTORY_TYPES, code prefix FCEIL).
--
-- 18 finish variants: MS + 3 SS grades + 14 designer finishes. Idempotent.

-- 1) Category under the top-level "Cabin" (so searchCabinBases finds it).
insert into item_categories (name, parent_id, procurement_type)
select 'False Ceiling', c.id, 'make'
from item_categories c
where c.name = 'Cabin' and c.parent_id is null
  and not exists (
    select 1 from item_categories x
    where x.name = 'False Ceiling' and x.parent_id = c.id
  );

-- 2) The 18 finish-variant items (FCEIL-001 .. FCEIL-018).
insert into items (code, name, item_type, category_id, uom_id, family, finish, procurement_type, is_active)
select 'FCEIL-' || lpad(v.seq::text, 3, '0'),
       'False Ceiling ' || v.finish,
       'finished_good'::item_type,
       fc.id, u.id, 'False Ceiling', v.finish, 'make', true
from (values
  (1, 'MS'), (2, 'SS 304'), (3, 'SS 430'), (4, 'SS 441'),
  (5, 'Mirror'), (6, 'Black Mirror'), (7, 'Golden Mirror'), (8, 'Rose Gold Mirror'),
  (9, 'White Mirror Silver'), (10, 'Black Hairline'), (11, 'Golden Hairline'), (12, 'Rose Gold Linen'),
  (13, 'Golden'), (14, 'Rose Gold'), (15, 'Champagne'), (16, 'Rose Gold Etching'),
  (17, 'Moon Rock'), (18, 'Honey Comb')
) as v(seq, finish)
cross join (
  select id from item_categories
  where name = 'False Ceiling'
    and parent_id = (select id from item_categories where name = 'Cabin' and parent_id is null)
) fc
cross join (select id from units_of_measurement where abbreviation = 'nos' limit 1) u
where not exists (select 1 from items i where i.code = 'FCEIL-' || lpad(v.seq::text, 3, '0'));
