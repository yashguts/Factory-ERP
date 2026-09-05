-- SS Sheet had no "SS Grade 316" sub-category, so the two Grade-316 sheets sat
-- loose under the parent while 304/430/441/J1 each had their own bucket. Create
-- the missing grade category, move the existing 316 sheets into it, and add the
-- 1.5mm sheet the owner asked for.
--
-- item_change_log rows mirror what createItem/updateItem would have written, so
-- these show up on /inventory/changes like any in-app edit.

WITH new_cat AS (
  INSERT INTO item_categories (name, parent_id, procurement_type)
  VALUES (
    'SS Grade 316',
    'd6dfce8f-3c0e-4ed7-9052-634bf25c8b2b',  -- SS Sheet
    'trade'
  )
  RETURNING id
),
moved AS (
  UPDATE items i
  SET category_id = (SELECT id FROM new_cat),
      updated_at  = now()
  FROM new_cat
  WHERE i.code IN ('RM-218', 'RM-219')
  RETURNING i.id, i.code, i.name, new_cat.id AS cat_id
),
created AS (
  INSERT INTO items (
    code, name, lookup_key, description, item_type, category_id, uom_id,
    minimum_stock, reorder_point, lead_time_days, cost_price,
    procurement_type, stock_behaviour, part_role, suppliers, is_active
  )
  SELECT
    'RM-222',
    '2500x1250x1.5mm/SS/Grade 316',
    '2500x1250x1.5mm/SS/Grade 316',
    '2500x1250x1.5mm/SS/Grade 316',
    'raw_material',
    (SELECT id FROM new_cat),
    '9ed3b796-f2a3-4336-8479-6db47c7a95ef',  -- Pieces
    0, 0, 0, 0,
    NULL,          -- inherit Trade from the category
    'stocked',
    'raw_material',
    '{}'::text[],  -- suppliers left blank; owner fills in
    true
  RETURNING id, code, name, category_id
),
log_create AS (
  INSERT INTO item_change_log (item_id, item_code, item_name, action, changes, note)
  SELECT c.id, c.code, c.name, 'create',
    jsonb_build_array(
      jsonb_build_object('field','code',           'old', NULL, 'new', c.code),
      jsonb_build_object('field','name',           'old', NULL, 'new', c.name),
      jsonb_build_object('field','description',    'old', NULL, 'new', c.name),
      jsonb_build_object('field','item_type',      'old', NULL, 'new', 'raw_material'),
      jsonb_build_object('field','category_id',    'old', NULL, 'new', c.category_id),
      jsonb_build_object('field','uom_id',         'old', NULL, 'new', '9ed3b796-f2a3-4336-8479-6db47c7a95ef'),
      jsonb_build_object('field','stock_behaviour','old', NULL, 'new', 'stocked')
    ),
    'Added via SQL — new SS Grade 316 sheet'
  FROM created c
  RETURNING 1
)
INSERT INTO item_change_log (item_id, item_code, item_name, action, changes, note)
SELECT m.id, m.code, m.name, 'update',
  jsonb_build_array(
    jsonb_build_object(
      'field','category_id',
      'old','d6dfce8f-3c0e-4ed7-9052-634bf25c8b2b',
      'new', m.cat_id
    )
  ),
  'Refiled under the new SS Sheet > SS Grade 316 category'
FROM moved m;
