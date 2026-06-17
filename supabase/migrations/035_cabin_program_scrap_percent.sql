-- 035 — cabin program scrap %
--
-- Cabin programs already carry `machining_time_seconds` and the sketch_* columns
-- (PDF/image attachment). This adds a scrap percentage so a cabin cutting program
-- can record the sheet wastage read off its nesting report, alongside the
-- machining time. Additive; nothing existing is touched.
ALTER TABLE cabin_programs ADD COLUMN IF NOT EXISTS scrap_percent numeric;
