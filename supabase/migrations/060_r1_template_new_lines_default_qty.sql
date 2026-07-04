-- R1 template additions (owner, 2026-07-04): Isolation Channel (search line in
-- Cabin after Safety Tips Plate), Cabin Handing Rod + Sensor Angle (fixed
-- items), GI Wire 2kg (fixed item in Troughing, default qty 2 for every job) —
-- plus a DEFAULT-QTY mechanism on template lines: default_qty seeds the
-- quantity on new lists; default_qty_drive_types limits it to specific job
-- drive types (the rod: 2 only on HOME/BELT = Home Rope / Home Belt).
-- Items created: SA-BF-594 Cabin Hanging Rod 12x2700, SA-BF-595 Sensor Angle
-- 2700, FG-CH-048 GI Wire 2kg. All 163 existing lists were backfilled with the
-- 4 lines (appended within their parts; qty per the default rules).
-- Applied to the remote DB on 2026-07-04 (full statement in the migration
-- history; see getR1List's seeding for the runtime rule).

alter table public.packing_template_lines
  add column if not exists default_qty numeric,
  add column if not exists default_qty_drive_types text[];
