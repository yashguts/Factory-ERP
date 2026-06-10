-- Machining time per run (from the CNC set-up schedule), in seconds.
-- NULL = not captured yet. Drives machine-time rollups in MRP planning.
-- Backfilled 2026-06-09 for all 281 audited programs by extracting the
-- "MACHINING TIME" field from their attached TruTops set-up-schedule PDFs.
ALTER TABLE operations
  ADD COLUMN machining_time_seconds integer
  CHECK (machining_time_seconds IS NULL OR machining_time_seconds > 0);
