-- 020: per-run material/scrap figures on operations.
--
-- Extracted from the attached TruTops "SET-UP SCHEDULE" sketch PDFs (one
-- sheet per run): sheet weight as printed by the machine, SCRAP % as printed,
-- scrap weight = sheet weight x scrap %. Populated 2026-06-11 by
-- scripts/apply-sketch-extract.js from a full scan of all 347 sketches
-- (347/347 parsed; one program's PDF prints a negative scrap % - left null).
-- machining_time_seconds was refreshed from the same scan (filled 40 nulls,
-- corrected one 1.7% drift; the other 306 matched the PDFs exactly).
alter table public.operations
  add column if not exists sheet_weight_kg numeric,
  add column if not exists scrap_percent numeric,
  add column if not exists scrap_weight_kg numeric;
