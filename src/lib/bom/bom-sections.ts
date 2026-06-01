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

  // ──────────────── BRACKETS ────────────────
  {
    category: "MAIN BRACKET",
    phase: "Brackets",
    gate: { kind: "driveTypeExclude", drives: ["HYD"] },
    fullWidth: true,
    description:
      "Rail Bracket Main + Combination (Main / Home) + Rail Clip Combination.",
    defaultItemCategories: [
      "Rail Bracket > Rail Bracket Main",
      "Rail Bracket > Rail Bracket Combination Main",
      "Rail Bracket > Rail Bracket Combination Home",
      "Rail Bracket > Rail Clip Combination",
    ],
  },
  {
    category: "COUNTER BRACKET",
    phase: "Brackets",
    gate: ALWAYS,
    defaultItemCategories: [
      "Rail Bracket > Rail Bracket Counter",
      "Rail Bracket > Rail Bracket Counter Home",
    ],
  },

  // ──────────────── RAIL CLIP (own phase) ────────────────
  {
    category: "RAIL CLIP",
    phase: "Rail Clip",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Rail Clip"],
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

  // ──────────────── DOOR SYSTEM ────────────────
  // Header System lives inside Door System (between Door Post/Frame and
  // Door Sill) — it's part of the door assembly, not its own phase.
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
    category: "Car Header System",
    phase: "Door System",
    gate: ALWAYS,
    description:
      "Car header (CO, MT variants) and car hanging brackets.",
    defaultItemCategories: [
      "Header Systems > Car Header System",
      "Header Systems > Car Header System (Framater)",
      "Header Systems > Manual Telescopic Car Header System",
      "Header Systems > Car Header Hanging Bkt",
    ],
  },
  {
    category: "Landing Header System",
    phase: "Door System",
    gate: ALWAYS,
    description: "Landing header (CO, MT variants).",
    defaultItemCategories: [
      "Header Systems > Landing Header System",
      "Header Systems > Manual Telescopic Landing Header System",
    ],
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

  // ──────────────── SAFETY & COUNTER FRAME ────────────────
  {
    category: "Safety",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    fullWidth: true,
    description:
      "Safety gear, frames, guide shoes — everything under Safety Frame.",
    defaultItemCategories: ["Safety Frame"],
  },
  {
    category: "Pulley Main",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    description:
      "Main sheave / drive pulley. Search any item in the Pulley Items category tree.",
    defaultItemCategories: ["Pulley Items"],
  },
  {
    category: "Pulley Counter",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    description:
      "Counter-weight pulley. Search any item in the Pulley Items category tree.",
    defaultItemCategories: ["Pulley Items"],
  },
  {
    category: "Pulley Diverter",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    description:
      "Diverter pulley. Search any item in the Pulley Items category tree.",
    defaultItemCategories: ["Pulley Items"],
  },
  {
    category: "Counter Frame",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    fullWidth: true,
    description: "Counter Weight Frame and its variants.",
    defaultItemCategories: ["Counter Weight Frame"],
  },
  {
    category: "Counter Guard Net",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Counter Guard Net"],
  },
  {
    category: "Pit Ladder",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Pit Ladder"],
  },
  {
    category: "Machine Beam",
    phase: "Safety & Counter Frame",
    gate: ALWAYS,
    fullWidth: true,
    description: "Machine Beam, brackets, pulley arrangement, hitch plates.",
    defaultItemCategories: ["Machine Beam"],
  },

  // ──────────────── MACHINE (own phase) ────────────────
  {
    category: "Machine",
    phase: "Machine",
    gate: ALWAYS,
    defaultItemCategories: ["Large Purchased Items > Machine Unit"],
  },

  // ──────────────── GOVERNOR (own phase) ────────────────
  {
    category: "Governor",
    phase: "Governor",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Speed Governor"],
  },

  // ──────────────── MISCELLANEOUS ITEMS ────────────────
  {
    category: "CONT. STAND",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    description: "Controller stand / controller bracket.",
    defaultItemCategories: ["Small Manufactured Items > Controller Bracket"],
  },
  {
    category: "TROUGHING 50",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Troughing"],
  },
  {
    category: "TROUGHING 100",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Troughing"],
  },
  {
    category: "LIMIT SWITCH",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Limit Switch Items"],
  },
  {
    category: "LIMIT SWITCH BRACKET",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    description:
      "Limit-switch mounting brackets. Same parent category as the switches themselves — pick the bracket items.",
    defaultItemCategories: ["Miscallaneous > Limit Switch Items"],
  },
  {
    category: "MAGNET WITH BRACKET",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    description: "Magnet brackets, trays, and holders.",
    defaultItemCategories: [
      "Small Manufactured Items > Magnet Bracket",
      "Small Manufactured Items > Magnet Trey",
      "Small Purchased Items > Magnet Holder",
    ],
  },
  {
    category: "PIT SWITCH",
    phase: "Miscellaneous Items",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Pit Switch Box"],
  },

  // ──────────────── WIRE ROPE / BELT ────────────────
  {
    category: "Wire Rope Main",
    phase: "Wire Rope/Belt",
    gate: ALWAYS,
    description: "Main hoist rope or drive belt.",
    defaultItemCategories: [
      "Large Purchased Items > Wire Rope",
      "Large Purchased Items > Belt",
    ],
  },
  {
    category: "Wire Rope Governor",
    phase: "Wire Rope/Belt",
    gate: ALWAYS,
    description: "Governor rope.",
    defaultItemCategories: [
      "Large Purchased Items > Wire Rope",
      "Large Purchased Items > Belt",
    ],
  },

  // ──────────────── WIRE & HARDWARE ────────────────
  // Rope hardware + stationary cams + buffer spring/stand.
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
    category: "D-SHACKLE",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ['Hardware > "D" Shackle'],
  },
  {
    category: "STA. CAM",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    description:
      "Stationary cams — Home / STD / Drumbwater / Bracket Home variants.",
    defaultItemCategories: [
      "Small Manufactured Items > Stationary Cam Bkt Home",
      "Small Manufactured Items > Stationary Cam Drumbwater",
      "Small Manufactured Items > Stationary Cam Home",
      "Small Manufactured Items > Stationary Cam STD",
    ],
  },
  {
    category: "Buffer Spring",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Hardware > Buffer Spring"],
  },
  {
    category: "Buffer Stand",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Buffer Stand"],
  },

  // ──────────────── FILLER WEIGHT (own phase) ────────────────
  {
    category: "Filler Weight",
    phase: "Filler Weight",
    gate: ALWAYS,
    fullWidth: true,
    defaultItemCategories: ["Filler Weight"],
  },

  // ──────────────── CABIN RUBBER PAD (own phase) ────────────────
  {
    category: "Cabin Rubber Pad",
    phase: "Cabin Rubber Pad",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Cabin Rubber Pad"],
  },

  // ──────────────── CABIN ADD-ON ITEMS ────────────────
  // Everything that lives inside the cabin or is part of the cabin-side
  // electrical fit-out. Replaces the old "Cabin & Electrics" phase.
  {
    category: "CABIN GLASS",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Glass > Cabin Glass"],
  },
  {
    category: "FLOOR TILES",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Floor Tiles"],
  },
  {
    category: "CHEQUERED PLATE",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    description: "Chequered floor plate — no dedicated inventory category yet.",
    defaultItemCategories: [],
  },
  {
    category: "SAFETY/CAR GATE SWT.",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Limit Switch Items"],
  },
  {
    category: "HOME SAFETY SWITCH",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    description: "Home safety switch — pick from limit switch items.",
    defaultItemCategories: ["Miscallaneous > Limit Switch Items"],
  },
  {
    category: "PVC CABLE HANGER",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > PVC Cable Hanger"],
  },
  {
    category: "RET. CAM",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    description: "Retiring cam set and its bracket.",
    defaultItemCategories: [
      "Small Purchased Items > Retiring Cam Set",
      "Small Manufactured Items > Returning Cam Bkt",
    ],
  },
  {
    category: "REED CHANNEL",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Manufactured Items > Read Channel/Switch Items"],
  },
  {
    category: "FAN GRILL",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Fan Grill"],
  },
  {
    category: "FIREMAN SWITCH",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Fireman's Switch Box"],
  },
  {
    category: "OIL POT",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    description: "Oil pot — pick from Oil/Mobil lubricants.",
    defaultItemCategories: ["Small Purchased Items > Oil/Mobil"],
  },
  {
    category: "Mobil T-40",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Oil/Mobil"],
  },
  {
    category: "Grease 200grm",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Small Purchased Items > Oil/Mobil"],
  },
  {
    category: "Safety Tips Plate",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Safety Tips Plate"],
  },
  {
    category: "Danger Plate",
    phase: "Cabin Add-on Items",
    gate: ALWAYS,
    defaultItemCategories: ["Miscallaneous > Danger Plate"],
  },
];

export const PHASE_ORDER = [
  "Structural",
  "Brackets",
  "Rail Clip",
  "Buffer & Channels",
  // Header System now lives inside Door System (between Door Post/Frame
  // and Door Sill); it's no longer a top-level phase.
  "Door System",
  "Safety & Counter Frame",
  "Machine",
  "Governor",
  "Miscellaneous Items",
  "Wire Rope/Belt",
  "Wire & Hardware",
  "Filler Weight",
  "Cabin Rubber Pad",
  "Cabin Add-on Items",
] as const;

/* ------------------------------------------------------------------ *
 * Dispatch phase (separate from the form `phase` grouping above).
 *
 * Elevators ship in two dispatches: first-phase material goes out early
 * (rails, brackets, the door frame/sill that's installed during the
 * structural work), second-phase is the rest (cabin, door panels,
 * machine, finishing). A job can dispatch first only, second only, or
 * both. Keyed by section `category` — which is exactly what's stored on
 * `job_bom_lines.category`, so any saved line classifies directly.
 * Anything not listed here (incl. ad-hoc sections) is second phase.
 * ------------------------------------------------------------------ */
export type DispatchPhase = "first" | "second";

export const FIRST_PHASE_SECTIONS: ReadonlySet<string> = new Set([
  "RAIL",
  "Stud Anchor",
  "BRICK",
  "MAIN BRACKET",
  "COUNTER BRACKET",
  "RAIL CLIP",
  "Buffer Channel Main",
  "Buffer Channel Counter",
  "Door Post / Frame",
  "Door Sill",
  "Linton Panel",
  "CONT. STAND",
  "TROUGHING 50",
  "TROUGHING 100",
  "FIREMAN SWITCH",
]);

/** Dispatch phase for a section/line by its stored `category` name. */
export function dispatchPhaseOf(category: string): DispatchPhase {
  return FIRST_PHASE_SECTIONS.has(category) ? "first" : "second";
}
