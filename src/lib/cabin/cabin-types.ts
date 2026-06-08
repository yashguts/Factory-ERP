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
  "Bottom Support (Glass) Cover",
  "Top Support (Glass)",
  "Top Support (Glass) Cover",
  "Car Linton",
  "Cabin Support",
  "Canopy",
  "Corner Wall Cover",
] as const;

export type CabinType = (typeof CABIN_TYPES)[number];

/**
 * Display order for the Cabin INVENTORY page. Front Wall RHS/LHS are collapsed
 * into a single "Front Wall" type here (they live as sub-categories under it in
 * the DB). Cabin JOBS still use the full {@link CABIN_TYPES} (RHS/LHS separate).
 */
export const CABIN_INVENTORY_TYPES = [
  "Platform",
  "Side Panel",
  "Front Wall",
  "Bottom Support (Glass)",
  "Bottom Support (Glass) Cover",
  "Top Support (Glass)",
  "Top Support (Glass) Cover",
  "Car Linton",
  "Cabin Support",
  "Canopy",
  "Corner Wall Cover",
] as const;

/** Code prefix per cabin type for auto-generated item codes (PLAT-001, …). */
export const CABIN_TYPE_CODE: Record<string, string> = {
  Platform: "PLAT",
  "Side Panel": "SIDE",
  "Front Wall": "FW",
  "Front Wall RHS": "FWRHS",
  "Front Wall LHS": "FWLHS",
  "Bottom Support (Glass)": "BSG",
  "Bottom Support (Glass) Cover": "BSGC",
  "Top Support (Glass)": "TSG",
  "Top Support (Glass) Cover": "TSGC",
  "Car Linton": "LINTON",
  "Cabin Support": "CSUP",
  Canopy: "CANOPY",
  "Corner Wall Cover": "CWCOV",
};

export function cabinCodePrefix(typeName?: string | null): string {
  return (typeName && CABIN_TYPE_CODE[typeName]) || "CAB";
}

/**
 * Map a cabin JOB type to the INVENTORY type whose items it should search.
 * Front Wall RHS/LHS were collapsed into a single "Front Wall" inventory type,
 * so both job blocks search within Front Wall. Everything else maps to itself.
 */
export function cabinInventoryType(jobType: string): string {
  if (jobType === "Front Wall RHS" || jobType === "Front Wall LHS") return "Front Wall";
  return jobType;
}
