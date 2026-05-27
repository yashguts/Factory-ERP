/**
 * BOM section definitions — each section is an inventory item picker.
 *
 * Each section's `defaultItemCategories` is a list of category PATH strings
 * (e.g. "Large Purchased Items > Guide Rail" or just "Filler Weight" for
 * a top-level category). At search time these are resolved to category IDs
 * and expanded to include all descendant sub-categories, so picking a
 * parent category includes everything beneath it.
 *
 * The path-resolution lives in `src/lib/actions/categories.ts`. If a path
 * doesn't match anything in the DB, that path is silently skipped — set
 * `defaultItemCategories: []` to allow the user to pick from any category.
 */

export type SectionGate =
  | { kind: "always" }
  | { kind: "doorType"; doors: string[] }
  | { kind: "driveType"; drives: string[] }
  | { kind: "driveTypeExclude"; drives: string[] };

export interface BomSection {
  /** Display name AND the `category` value stored in job_bom_lines. */
  category: string;
  /**
   * Phase label. Hardcoded sections use one of {@link PHASE_ORDER};
   * user-added ad-hoc sections may use any string (e.g. "Additional Items").
   */
  phase: (typeof PHASE_ORDER)[number] | string;
  gate: SectionGate;
  fullWidth?: boolean;
  description?: string;
  /**
   * Category PATH strings used to scope the item search.
   * Examples: "Large Purchased Items > Guide Rail", "Filler Weight",
   * "Hardware > Thimbel". Parent paths include all descendants.
   */
  defaultItemCategories?: string[];
}

const ALWAYS: SectionGate = { kind: "always" };

export const BOM_SECTIONS: BomSection[] = [
  // ──────────────── STRUCTURAL ────────────────
  {
    category: "RAIL",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["Large Purchased Items > Guide Rail"],
  },
  {
    category: "Stud Anchor",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Stud Anchor"],
  },
  {
    category: "BRICK",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Brick Dasfastner"],
  },
  {
    category: "RAIL CLIP",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Rail Clip"],
  },

  // ──────────────── BRACKETS ────────────────
  {
    category: "MAIN BRACKET",
    phase: "Brackets",
    gate: { kind: "driveTypeExclude", drives: ["HYD"] },
    fullWidth: true,
    description: "Includes Rail Bracket Main, Combination Main, Rail Clip Combination.",
    defaultItemCategories: [
      "Rail Bracket > Rail Bracket Main",
      "Rail Bracket > Rail Bracket Combination Main",
      "Rail Bracket > Rail Clip Combination",
    ],
  },
  {
    category: "COUNTER BRACKET",
    phase: "Brackets",
    gate: { kind: "driveType", drives: ["MR", "HYD"] },
    defaultItemCategories: [
      "Rail Bracket > Rail Bracket Counter",
      "Rail Bracket > Rail Bracket Counter Home",
    ],
  },

  // ──────────────── DOOR SYSTEM ────────────────
  // Each door sub-type gets its own section so the search is scoped tightly
  // and quantities can be tracked per type.
  {
    category: "Car Door Panel",
    phase: "Door System",
    gate: ALWAYS,
    defaultItemCategories: ["Car Door Pannel"],
  },
  {
    category: "Landing Door Panel",
    phase: "Door System",
    gate: ALWAYS,
    defaultItemCategories: ["Landing Door Pannel"],
  },
  {
    category: "Door Post / Frame",
    phase: "Door System",
    gate: ALWAYS,
    defaultItemCategories: ["Door Post/Frame"],
  },
  {
    category: "Door Sill",
    phase: "Door System",
    gate: ALWAYS,
    defaultItemCategories: ["Door Sill"],
  },
  {
    category: "Linton Panel",
    phase: "Door System",
    gate: ALWAYS,
    defaultItemCategories: ["Linton Pannel"],
  },
  {
    category: "Gate Lock",
    phase: "Door System",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Gate Lock Items"],
  },

  // ──────────────── HEADER SYSTEM ────────────────
  {
    category: "Header System",
    phase: "Header System",
    gate: ALWAYS,
    fullWidth: true,
    description:
      "Car / landing header systems, hanging brackets, shoe channel.",
    defaultItemCategories: ["Header Systems"],
  },

  // ──────────────── BUFFER & CHANNELS ────────────────
  {
    category: "Buffer Channel Main",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Buffer Channel"],
  },
  {
    category: "Buffer Channel Counter",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Buffer Channel"],
  },
  {
    category: "Buffer Spring",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Buffer Spring"],
  },
  {
    category: "Safety",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    fullWidth: true,
    description:
      "Safety gear, frames, guide shoes — everything under Safety Frame.",
    defaultItemCategories: ["Safety Frame"],
  },
  {
    category: "Buffer Stand",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Buffer Stand"],
  },
  {
    category: "Cabin Rubber Pad",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Cabin Rubber Pad"],
  },
  {
    category: "Filler Weight",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    fullWidth: true,
    defaultItemCategories: ["Filler Weight"],
  },

  // ──────────────── DRIVE / MACHINE / GOVERNOR ────────────────
  {
    category: "Machine",
    phase: "Drive / Machine / Governor",
    gate: ALWAYS,
    defaultItemCategories: ["Large Purchased Items > Machine Unit"],
  },
  {
    category: "Governor",
    phase: "Drive / Machine / Governor",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Speed Governor"],
  },

  // ──────────────── WIRE & HARDWARE ────────────────
  {
    category: "Wire Rope",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Large Purchased Items > Wire Rope"],
  },
  {
    category: "I-Bolt with Spring",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: [
      "Hardware > I-Bolt Spring",
      "Hardware > I-Bolt Rod",
      "Hardware > Belt I-Bolt Rod",
    ],
  },
  {
    category: "Thimble",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Thimbel"],
  },
  {
    category: "Bull Dog Clip",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Bull Dog Clips"],
  },
  {
    category: "Misc Hardware",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    description: "Bearings, gathering clips, M.S bush, rag bolts, etc.",
    defaultItemCategories: ["Hardware"],
  },

  // ──────────────── CABIN & ELECTRICS ────────────────
  // Each cabin fitting gets its own section so the search is scoped to
  // the right sub-category and quantities are tracked per item type.
  {
    category: "Cabin Glass",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Glass > Cabin Glass"],
  },
  {
    category: "Floor Tiles",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Floor Tiles"],
  },
  {
    category: "Fan / Ventilation",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Fan Grill"],
  },
  {
    category: "LOP Box",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Lop Box"],
  },
  {
    category: "Limit Switch Items",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Limit Switch Items"],
  },
  {
    category: "Cabin Handles",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > S.S Handle"],
  },
  {
    category: "Cabin Signage",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    description: "Danger plate, safety-tips plate, etc.",
    defaultItemCategories: [
      "Miscallaneous > Danger Plate",
      "Miscallaneous > Safety Tips Plate",
    ],
  },
];

export const PHASE_ORDER = [
  "Structural",
  "Brackets",
  "Door System",
  "Header System",
  "Buffer & Channels",
  "Drive / Machine / Governor",
  "Wire & Hardware",
  "Cabin & Electrics",
] as const;
