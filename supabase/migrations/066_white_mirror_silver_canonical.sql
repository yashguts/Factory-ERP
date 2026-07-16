-- Canonical finish "White Mirror Silver" (owner, 2026-07-11).
-- The same physical finish (sheet RM-037 "2500X1250X1.0mm/SS Designer/White
-- Mirror Silver") was written two ways: Cabin Inventory is already canonical
-- ("White Mirror Silver" on all 753 fanned items), but the DOOR-world items and
-- the CNC program labels said "Silver Mirror". Rename those to the canonical
-- name so one finish reads identically across cabin inventory, cabin jobs, job
-- items and programs. Code-side, lib/cabin/finish-alias.ts normalises sketch
-- variants ("White Mirror" / "White Silver Mirror" / "Mirror Silver") at match
-- time. EXCLUDED: RM-206 "Silver Mirror Etchaing JE-131" (a different designer
-- sheet) and every already-canonical name. Verified before applying: no rename
-- collides with an existing active item name; verified after: 0 variants left,
-- 0 duplicate active names.

-- Items: name + finish + the lookup_key = name invariant.
update items i
set name = replace(i.name, 'Silver Mirror', 'White Mirror Silver'),
    lookup_key = replace(i.name, 'Silver Mirror', 'White Mirror Silver'),
    finish = case when i.finish ilike '%Silver Mirror%'
                  then replace(i.finish, 'Silver Mirror', 'White Mirror Silver')
                  else i.finish end,
    updated_at = now()
where (i.name like '%Silver Mirror%' or coalesce(i.finish,'') like '%Silver Mirror%')
  and i.name not like '%White Mirror Silver%'
  and coalesce(i.finish,'') not like '%White Mirror Silver%'
  and i.name not ilike '%Etchaing%'
  -- defensive: never create a duplicate active name
  and not exists (
    select 1 from items t
    where t.is_active and t.id <> i.id
      and lower(trim(t.name)) = lower(trim(replace(i.name, 'Silver Mirror', 'White Mirror Silver')))
  );

-- Programs: display label + name (codes are identity — untouched).
update operations o
set material_label = replace(o.material_label, 'Silver Mirror', 'White Mirror Silver')
where o.material_label like '%Silver Mirror%'
  and o.material_label not like '%White Mirror Silver%';

update operations o
set name = replace(o.name, 'Silver Mirror', 'White Mirror Silver')
where o.name like '%Silver Mirror%'
  and o.name not like '%White Mirror Silver%';
