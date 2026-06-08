/**
 * Cabin Inventory types — the part types that make up an elevator cabin.
 * Single source of truth for display order. Each is stored as an
 * `item_categories` row under the top-level "Cabin" category, so cabin
 * items get filed under one of these.
 */
export const CABIN_PARENT = "Cabin";

export const CABIN_TYPES = [
  "Platform",
  "Side Panel",
  "Front Wall RHS",
  "Front Wall LHS",
  "Bottom Support (Glass)",
  "Top Support (Glass)",
  "Linton",
  "Cabin Support",
  "Corner Wall",
  "Canopy",
  "Corner Wall Cover",
] as const;

export type CabinType = (typeof CABIN_TYPES)[number];
