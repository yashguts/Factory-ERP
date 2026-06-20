-- Part List: a line can be a deliberate NON-INVENTORY item (e.g. fish plate, a
-- cut-from-sheet part) — valid for "Ready" without an item_id. ADDITIVE.
ALTER TABLE public.packing_list_lines
  ADD COLUMN IF NOT EXISTS non_inventory boolean NOT NULL DEFAULT false;
