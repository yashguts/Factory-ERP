-- 036 — program (operation) scrap %
--
-- Regular programs already store machining_time_seconds + the sketch PDF; this
-- adds a scrap percentage so a program can record the sheet wastage read off its
-- TruTops set-up schedule, alongside the machining time (mirrors cabin_programs).
-- Additive; nothing existing is touched.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS scrap_percent numeric;
