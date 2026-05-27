/**
 * BOM section definitions — each section is an inventory item picker.
 *
 * Sections no longer have hardcoded leaves/variants. Instead each section
 * specifies `defaultItemCategories` (item_categories.name values) used to
 * pre-filter the item search. Users can toggle to search all categories.
 */

export type SectionGate =
  | { kind: "always" }
  | { kind: "doorType"; doors: string[] }
  | { kind: "driveType"; drives: string[] }
  | { kind: "driveTypeExclude"; drives: string[] };

export interface BomSection {
  /** Display name AND the `category` value stored in job_bom_lines. */
  category: string;
  phase: (typeof PHASE_ORDER)[number];
  gate: SectionGate;
  fullWidth?: boolean;
  description?: string;
  /**
   * item_categories.name values to filter the item search by default.
   * If the category names don't match anything in the DB, the section
   * will start empty and the user can toggle "All categories" to browse.
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
    defaultItemCategories: ["RAIL"],
  },
  {
    category: "Stud Anchor",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["Stud Anchor"],
  },
  {
    category: "BRICK",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["BRICK"],
  },
  {
    category: "RAIL CLIP",
    phase: "Structural",
    gate: ALWAYS,
    defaultItemCategories: ["RAIL CLIP"],
  },

  // ──────────────── BRACKETS ────────────────
  {
    category: "MAIN BRACKET",
    phase: "Brackets",
    gate: { kind: "driveTypeExclude", drives: ["HYD"] },
    fullWidth: true,
    defaultItemCategories: ["MAIN BRACKET"],
  },
  {
    category: "COUNTER BRACKET",
    phase: "Brackets",
    gate: { kind: "driveType", drives: ["MR", "HYD"] },
    defaultItemCategories: ["COUNTER BRACKET"],
  },

  // ──────────────── DOOR SYSTEM ────────────────
  {
    category: "Car & Landing Doors",
    phase: "Door System",
    gate: ALWAYS,
    fullWidth: true,
    description: "Car doors, landing doors, frames, and locks.",
    defaultItemCategories: [
      "Car Door",
      "Landing Door",
      "Door Lock",
      "Door Frame",
      "Car & Landing Doors",
    ],
  },

  // ──────────────── BUFFER & CHANNELS ────────────────
  {
    category: "Buffer Channel Main",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Buffer Channel Main"],
  },
  {
    category: "Buffer Channel Counter",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Buffer Channel Counter"],
  },
  {
    category: "Buffer Spring",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Buffer Spring"],
  },
  {
    category: "Safety",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    fullWidth: true,
    description:
      "Safety gear, pulleys, counter frame, guard net and machine beams.",
    defaultItemCategories: ["Safety"],
  },
  {
    category: "Buffer Stand",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Buffer Stand"],
  },
  {
    category: "Cabin Rubber Pad",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    defaultItemCategories: ["Cabin Rubber Pad"],
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
    defaultItemCategories: ["Machine"],
  },
  {
    category: "Governor",
    phase: "Drive / Machine / Governor",
    gate: ALWAYS,
    defaultItemCategories: ["Governor"],
  },

  // ──────────────── WIRE & HARDWARE ────────────────
  {
    category: "Wire Rope",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Wire Rope"],
  },
  {
    category: "I-Bolt with Spring",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["I-Bolt with Spring"],
  },
  {
    category: "Thimble",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Thimble"],
  },
  {
    category: "Bull Dog Clip",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Bull Dog Clip"],
  },
  {
    category: "Misc Hardware",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Misc Hardware"],
  },

  // ──────────────── CABIN & ELECTRICS ────────────────
  {
    category: "Cabin",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    defaultItemCategories: ["Cabin"],
  },
  {
    category: "Cabin Items",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    fullWidth: true,
    defaultItemCategories: ["Cabin Items"],
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
