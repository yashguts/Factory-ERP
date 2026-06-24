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
  "Cabin Glass",
  "Front Wall RHS",
  "Front Wall LHS",
  "Front Cover",
  "Bottom Support (Glass)",
  "Bottom Support (Glass) Cover",
  "Top Support (Glass)",
  "Top Support (Glass) Cover",
  "Car Linton",
  "Cabin Support",
  "Canopy",
  "False Ceiling",
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
  "Front Cover",
  "Bottom Support (Glass)",
  "Bottom Support (Glass) Cover",
  "Top Support (Glass)",
  "Top Support (Glass) Cover",
  "Car Linton",
  "Cabin Support",
  "Canopy",
  "False Ceiling",
  "Corner Wall Cover",
] as const;

/** Code prefix per cabin type for auto-generated item codes (PLAT-001, …). */
export const CABIN_TYPE_CODE: Record<string, string> = {
  Platform: "PLAT",
  "Side Panel": "SIDE",
  "Front Wall": "FW",
  "Front Cover": "FC",
  "Front Wall RHS": "FWRHS",
  "Front Wall LHS": "FWLHS",
  "Bottom Support (Glass)": "BSG",
  "Bottom Support (Glass) Cover": "BSGC",
  "Top Support (Glass)": "TSG",
  "Top Support (Glass) Cover": "TSGC",
  "Car Linton": "LINTON",
  "Cabin Support": "CSUP",
  Canopy: "CANOPY",
  "False Ceiling": "FCEIL",
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

/**
 * Cabin INVENTORY types whose items are fanned out by finish. For these, the New
 * Cabin Job picker is two-step (base item -> finish) instead of one long list.
 * Everything else (Platform, Canopy, Supports, Covers, ...) stays single-select.
 */
export const FINISH_SPLIT_INVENTORY_TYPES = ["Side Panel", "Front Wall", "Car Linton", "Front Cover", "False Ceiling"] as const;

export function isFinishSplitType(jobType: string): boolean {
  return (FINISH_SPLIT_INVENTORY_TYPES as readonly string[]).includes(
    cabinInventoryType(jobType),
  );
}

/**
 * Canonical finish fan-out set for a cabin panel (Side Panel / Front Wall):
 * MS + the three stocking SS grades + the 24 designer finishes = 28. Used by the
 * "create all finish variants" action so a new panel can be blown up into every
 * finish at once, matching the existing P2C-350-style families. The grade rows
 * come first (the everyday ones), then the designers.
 */
export const CABIN_PANEL_GRADE_FINISHES = ["MS", "SS 304", "SS 430", "SS 441"] as const;
export const CABIN_PANEL_DESIGNER_FINISHES = [
  "Black Hairline", "Black Mirror", "Blue Flower", "Bronze", "Champagne", "Chequered",
  "Designer IPF01", "Golden", "Golden Hairline", "Golden Jewellery", "Golden Mirror",
  "Grade 430 Mirror", "Honey Comb", "Mirror", "Moon Rock", "Rose Gold", "Rose Gold Etching",
  "Rose Gold Linen", "Rose Gold Mirror", "Silver Horizontal", "Silver Linen", "Silver Vertical",
  "White Mirror Silver", "Wooden",
] as const;
export const CABIN_PANEL_FINISHES: string[] = [
  ...CABIN_PANEL_GRADE_FINISHES,
  ...CABIN_PANEL_DESIGNER_FINISHES,
];
