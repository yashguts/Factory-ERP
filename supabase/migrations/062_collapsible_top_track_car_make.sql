-- 062 — classify "Collapsible Top track Car" as a Make item
-- Owner (2026-07-07): Collapsible Top Track Car is a Make item. Its category
-- procurement_type was NULL, so its 17 items (SA-CT-119..135) resolved to
-- NEITHER Make nor Trade MRP (effective procurement_type = item.proc ?? cat.proc).
-- Its sibling category "Collapsible Top track Landing" is already 'make'; mirror
-- it so all 17 inherit Make. No item-level overrides existed to conflict.
update item_categories
set procurement_type = 'make'
where id = '89a9adbb-0fb6-4d9f-b992-e0d6d8e4a6cc'
  and name = 'Collapsible Top track Car';
