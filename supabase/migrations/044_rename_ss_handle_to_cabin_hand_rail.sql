-- Rename the "S.S Handle" item category to "Cabin Hand Rail" and flip it to make.
-- Its 15 items (FG-BF-069..083) inherit procurement_type from the category, so they
-- move to "Cabin Hand Rail" and become Make in one step. The part-list particular
-- "S.S Handle" is renamed to "S.S. Hand Rail" and scoped to this category
-- (see scripts/_partlist_build.js). Item names are left unchanged.
update item_categories
set name = 'Cabin Hand Rail', procurement_type = 'make'
where name = 'S.S Handle';
