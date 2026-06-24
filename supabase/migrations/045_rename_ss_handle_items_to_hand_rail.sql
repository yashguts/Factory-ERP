-- The 15 hand-rail items were named "S.S Handle {size}mm" — "Handle" is wrong, the
-- part is a hand rail. Rename "Handle" -> "Hand Rail" in their names, giving
-- "S.S Hand Rail {size}mm". Their category was already renamed to "Cabin Hand Rail"
-- in migration 044. Scoped to these items only (not e.g. "Handle With Cover").
update items
set name = replace(name, 'Handle', 'Hand Rail')
where name like 'S.S Handle%';
