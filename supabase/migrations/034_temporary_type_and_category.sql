-- 034 — "Temporary" item type + Temporary category/sub-category
--
-- Adds a throwaway/placeholder classification so items that aren't yet properly
-- categorised can be parked under Type=Temporary, Category=Temporary,
-- Sub-category=Temporary. Purely additive; no existing data is touched.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` must be committed before the new value can be
-- USED. We don't use it here (categories are plain text), so this is safe to run
-- as-is. The item-form Category dropdown was also taught to fall back to "all
-- categories" for a type with no items yet, so the new type is immediately usable.

-- 1) New item_type enum value.
ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'temporary';

-- 2) Top-level "Temporary" category (procurement_type NULL = unclassified).
INSERT INTO item_categories (name, parent_id, procurement_type)
SELECT 'Temporary', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM item_categories WHERE name = 'Temporary' AND parent_id IS NULL
);

-- 3) "Temporary" sub-category beneath it.
INSERT INTO item_categories (name, parent_id, procurement_type)
SELECT 'Temporary',
       (SELECT id FROM item_categories WHERE name = 'Temporary' AND parent_id IS NULL LIMIT 1),
       NULL
WHERE NOT EXISTS (
  SELECT 1 FROM item_categories c
  WHERE c.name = 'Temporary'
    AND c.parent_id = (SELECT id FROM item_categories WHERE name = 'Temporary' AND parent_id IS NULL LIMIT 1)
);
