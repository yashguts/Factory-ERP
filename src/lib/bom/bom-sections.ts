export type BomLeafKind = "number" | "text" | "select";

export interface BomLeaf {
  variant: string;
  kind: BomLeafKind;
  unit?: string;
  options?: string[];
}

export type SectionGate =
  | { kind: "always" }
  | { kind: "doorType"; doors: string[] }
  | { kind: "driveType"; drives: string[] };

export interface BomSection {
  category: string;
  description?: string;
  phase: typeof PHASE_ORDER[number];
  gate: SectionGate;
  fullWidth?: boolean;
  customEditor?: string;
  leaves: BomLeaf[];
}

const ALWAYS: SectionGate = { kind: "always" };

export const BOM_SECTIONS: BomSection[] = [
  // ──────────────── STRUCTURAL ────────────────
  {
    category: "RAIL",
    phase: "Structural",
    gate: ALWAYS,
    leaves: [
      { variant: "16/75-R", kind: "number", unit: "pcs" },
      { variant: "16-R", kind: "number", unit: "pcs" },
      { variant: "9-R", kind: "number", unit: "pcs" },
      { variant: "6-R", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Stud Anchor",
    phase: "Structural",
    gate: ALWAYS,
    leaves: [
      { variant: "8x75", kind: "number", unit: "pcs" },
      { variant: "10X90", kind: "number", unit: "pcs" },
      { variant: "12X100", kind: "number", unit: "pcs" },
      { variant: "12X120", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "BRICK",
    phase: "Structural",
    gate: ALWAYS,
    leaves: [
      { variant: "8X75", kind: "number", unit: "pcs" },
      { variant: "12X150", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "RAIL CLIP",
    phase: "Structural",
    gate: ALWAYS,
    leaves: [
      { variant: "Small", kind: "number", unit: "pcs" },
      { variant: "Big", kind: "number", unit: "pcs" },
      { variant: "Goods", kind: "number", unit: "pcs" },
    ],
  },

  // ──────────────── BRACKETS ────────────────
  {
    category: "MAIN BRACKET",
    phase: "Brackets",
    description:
      "Pick how many bracket types this job uses (1-4), then specify each one.",
    gate: ALWAYS,
    fullWidth: true,
    customEditor: "main-bracket",
    leaves: [
      { variant: "Number of Types", kind: "select", options: ["1", "2", "3", "4"] },
      { variant: "Type 1", kind: "text" },
      { variant: "Quantity 1", kind: "number", unit: "pcs" },
      { variant: "Combination 1", kind: "text" },
      { variant: "Type 2", kind: "text" },
      { variant: "Quantity 2", kind: "number", unit: "pcs" },
      { variant: "Combination 2", kind: "text" },
      { variant: "Type 3", kind: "text" },
      { variant: "Quantity 3", kind: "number", unit: "pcs" },
      { variant: "Combination 3", kind: "text" },
      { variant: "Type 4", kind: "text" },
      { variant: "Quantity 4", kind: "number", unit: "pcs" },
      { variant: "Combination 4", kind: "text" },
    ],
  },
  {
    category: "COUNTER BRACKET",
    phase: "Brackets",
    description: "Counter bracket types (1-4). Only shown for MR drives.",
    gate: { kind: "driveType", drives: ["MR"] },
    customEditor: "counter-bracket",
    leaves: [
      { variant: "Number of Types", kind: "select", options: ["1", "2", "3", "4"] },
      { variant: "Type 1", kind: "text" },
      { variant: "Quantity 1", kind: "number", unit: "pcs" },
      { variant: "Type 2", kind: "text" },
      { variant: "Quantity 2", kind: "number", unit: "pcs" },
      { variant: "Type 3", kind: "text" },
      { variant: "Quantity 3", kind: "number", unit: "pcs" },
      { variant: "Type 4", kind: "text" },
      { variant: "Quantity 4", kind: "number", unit: "pcs" },
    ],
  },

  // ──────────────── DOOR SYSTEM ────────────────
  {
    category: "Car & Landing Doors",
    phase: "Door System",
    description: "Specify each car door and landing door.",
    gate: ALWAYS,
    fullWidth: true,
    customEditor: "car-landing-doors",
    leaves: [
      { variant: "Fire Rated", kind: "select", options: ["Yes", "No"] },
      { variant: "Door Opening Height", kind: "text" },
      { variant: "Number of Car Doors", kind: "select", options: ["1", "2"] },
      { variant: "Car Door 1 Type", kind: "text" },
      { variant: "Car Door 1 Material", kind: "text" },
      { variant: "Car Door 1 Vision", kind: "text" },
      { variant: "Car Door 1 Orientation", kind: "text" },
      { variant: "Car Door 1 Opening", kind: "text" },
      { variant: "Car Door 2 Type", kind: "text" },
      { variant: "Car Door 2 Material", kind: "text" },
      { variant: "Car Door 2 Vision", kind: "text" },
      { variant: "Car Door 2 Orientation", kind: "text" },
      { variant: "Car Door 2 Opening", kind: "text" },
      { variant: "Number of Landing Door Types", kind: "select", options: ["1", "2"] },
      { variant: "Landing Door 1 Type", kind: "text" },
      { variant: "Landing Door 1 Material", kind: "text" },
      { variant: "Landing Door 1 Vision", kind: "text" },
      { variant: "Landing Door 1 Orientation", kind: "text" },
      { variant: "Landing Door 1 Opening", kind: "text" },
      { variant: "Landing Door 1 Quantity", kind: "number", unit: "pcs" },
      { variant: "Landing Door 2 Type", kind: "text" },
      { variant: "Landing Door 2 Material", kind: "text" },
      { variant: "Landing Door 2 Vision", kind: "text" },
      { variant: "Landing Door 2 Orientation", kind: "text" },
      { variant: "Landing Door 2 Opening", kind: "text" },
      { variant: "Landing Door 2 Quantity", kind: "number", unit: "pcs" },
      { variant: "Landing Door Frame 1 Material", kind: "text" },
      { variant: "Landing Door Frame 1 Opening Side", kind: "text" },
      { variant: "Landing Door Frame 2 Material", kind: "text" },
      { variant: "Landing Door Frame 2 Opening Side", kind: "text" },
      { variant: "Door Lock Type", kind: "text" },
      { variant: "Door Lock Quantity", kind: "number", unit: "pcs" },
    ],
  },

  // ──────────────── BUFFER & CHANNELS ────────────────
  {
    category: "Buffer Channel Main",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    leaves: [
      { variant: "942-1042", kind: "number", unit: "pcs" },
      { variant: "1062-1162", kind: "number", unit: "pcs" },
      { variant: "1182-1292", kind: "number", unit: "pcs" },
      { variant: "1312-1412", kind: "number", unit: "pcs" },
      { variant: "1442-1542", kind: "number", unit: "pcs" },
      { variant: "GOODS", kind: "number", unit: "pcs" },
      {
        variant: "Combination Buffer Channel Size",
        kind: "select",
        options: ["520", "600", "620", "700", "720", "820"],
      },
    ],
  },
  {
    category: "Buffer Channel Counter",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    leaves: [
      { variant: "710-B", kind: "number", unit: "pcs" },
      { variant: "850-B", kind: "number", unit: "pcs" },
      { variant: "1050-B", kind: "number", unit: "pcs" },
      { variant: "1550-B", kind: "number", unit: "pcs" },
      { variant: "1750-B", kind: "number", unit: "pcs" },
      { variant: "2450", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Buffer Spring",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    leaves: [
      { variant: "STD", kind: "number", unit: "pcs" },
      { variant: "HOME", kind: "number", unit: "pcs" },
      { variant: "GOODS", kind: "number", unit: "pcs" },
      { variant: "OIL BUFFER", kind: "number", unit: "pcs" },
      { variant: "Rubber Pad", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Safety",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    leaves: [
      { variant: "Type", kind: "text" },
      { variant: "DBG", kind: "text" },
      { variant: "Main Pulley Specifications", kind: "text" },
      { variant: "Main Pulley Quantity", kind: "number", unit: "pcs" },
      { variant: "Counter Pulley Specifications", kind: "text" },
      { variant: "Counter Pulley Quantity", kind: "number", unit: "pcs" },
      { variant: "Diverter Pulley Specifications", kind: "text" },
      { variant: "Diverter Pulley Quantity", kind: "number", unit: "pcs" },
      { variant: "Counter Frame Rope/Belt", kind: "text" },
      { variant: "Counter Frame Type", kind: "text" },
      { variant: "Counter Frame Quantity", kind: "number", unit: "pcs" },
      { variant: "Counter Guard Net Type", kind: "text" },
      { variant: "Counter Guard Net Quantity", kind: "number", unit: "pcs" },
      { variant: "Pit Ladder Quantity", kind: "number", unit: "pcs" },
      { variant: "Machine Beam Home", kind: "text" },
      { variant: "Machine Beam 2:1", kind: "text" },
      { variant: "Machine Beam 4:1", kind: "text" },
    ],
  },
  {
    category: "Buffer Stand",
    phase: "Buffer & Channels",
    description: "Quantities for main and counter buffer stands.",
    gate: ALWAYS,
    leaves: [
      { variant: "Main Stand Qty", kind: "number", unit: "pcs" },
      { variant: "Counter Stand Qty", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Cabin Rubber Pad",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    leaves: [
      { variant: "Square", kind: "number", unit: "pcs" },
      { variant: "Round", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Filler Weight",
    phase: "Buffer & Channels",
    gate: ALWAYS,
    leaves: [
      { variant: "610/AHM", kind: "number", unit: "pcs" },
      { variant: "710/AHM", kind: "number", unit: "pcs" },
      { variant: "850X100/AHM", kind: "number", unit: "pcs" },
      { variant: "850X150/AHM", kind: "number", unit: "pcs" },
      { variant: "850X200/AHM", kind: "number", unit: "pcs" },
      { variant: "850X250/AHM", kind: "number", unit: "pcs" },
      { variant: "1050/AHM", kind: "number", unit: "pcs" },
      { variant: "1050X200/AHM", kind: "number", unit: "pcs" },
      { variant: "1050X350/AHM", kind: "number", unit: "pcs" },
      { variant: "710/CI", kind: "number", unit: "pcs" },
      { variant: "850X150/CI", kind: "number", unit: "pcs" },
      { variant: "850X200/CI", kind: "number", unit: "pcs" },
      { variant: "850X250/CI", kind: "number", unit: "pcs" },
      { variant: "1050/CI", kind: "number", unit: "pcs" },
      { variant: "550/HOME", kind: "number", unit: "pcs" },
      { variant: "650/HOME", kind: "number", unit: "pcs" },
      { variant: "750/HOME", kind: "number", unit: "pcs" },
      { variant: "850/HOME", kind: "number", unit: "pcs" },
    ],
  },

  // ──────────────── DRIVE / MACHINE / GOVERNOR ────────────────
  {
    category: "Machine",
    phase: "Drive / Machine / Governor",
    gate: ALWAYS,
    leaves: [
      { variant: "Machine Type", kind: "text" },
      { variant: "Machine Capacity", kind: "text" },
    ],
  },
  {
    category: "Governor",
    phase: "Drive / Machine / Governor",
    gate: ALWAYS,
    leaves: [
      { variant: "Type", kind: "text" },
      { variant: "CONT. STAND", kind: "number", unit: "pcs" },
      { variant: "TROUGHING 50", kind: "number", unit: "m" },
      { variant: "TROUGHING 100", kind: "number", unit: "m" },
      { variant: "LIMIT SWITCH", kind: "number", unit: "pcs" },
      { variant: "LIMIT SWITCH BRACKET", kind: "number", unit: "pcs" },
      { variant: "MAGNET WITH BRACKET", kind: "number", unit: "pcs" },
      { variant: "PIT SWITCH", kind: "number", unit: "pcs" },
      { variant: "BELT", kind: "number", unit: "m" },
    ],
  },

  // ──────────────── WIRE & HARDWARE ────────────────
  {
    category: "Wire Rope",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    leaves: [
      { variant: "Main 6mm", kind: "number", unit: "m" },
      { variant: "Main 8mm", kind: "number", unit: "m" },
      { variant: "Main 10mm", kind: "number", unit: "m" },
      { variant: "Main 13mm", kind: "number", unit: "m" },
      { variant: "Main 16mm", kind: "number", unit: "m" },
      { variant: "GOV 8mm", kind: "number", unit: "m" },
      { variant: "Belt", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "I-Bolt with Spring",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    leaves: [
      { variant: "8mm", kind: "number", unit: "pcs" },
      { variant: "12mm small", kind: "number", unit: "pcs" },
      { variant: "12mm big", kind: "number", unit: "pcs" },
      { variant: "16mm", kind: "number", unit: "pcs" },
      { variant: "20mm", kind: "number", unit: "pcs" },
      { variant: "24mm", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Thimble",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    leaves: [
      { variant: "6mm", kind: "number", unit: "pcs" },
      { variant: "8mm", kind: "number", unit: "pcs" },
      { variant: "10mm", kind: "number", unit: "pcs" },
      { variant: "13mm", kind: "number", unit: "pcs" },
      { variant: "16mm", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Bull Dog Clip",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    leaves: [
      { variant: "6mm", kind: "number", unit: "pcs" },
      { variant: "8mm", kind: "number", unit: "pcs" },
      { variant: "10mm", kind: "number", unit: "pcs" },
      { variant: "13mm", kind: "number", unit: "pcs" },
      { variant: "16mm", kind: "number", unit: "pcs" },
    ],
  },
  {
    category: "Misc Hardware",
    phase: "Wire & Hardware",
    gate: ALWAYS,
    leaves: [
      { variant: "D-Shackle", kind: "number", unit: "pcs" },
      { variant: "Sta. Cam", kind: "text" },
    ],
  },

  // ──────────────── CABIN & ELECTRICS ────────────────
  {
    category: "Cabin",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    leaves: [
      { variant: "Type", kind: "text" },
      { variant: "Size", kind: "text", unit: "W x L mm" },
    ],
  },
  {
    category: "Cabin Items",
    phase: "Cabin & Electrics",
    gate: ALWAYS,
    leaves: [
      { variant: "Cabin Glass", kind: "number", unit: "pcs" },
      { variant: "Floor Tiles", kind: "number", unit: "pcs" },
      { variant: "Chequered Plate (Aluminium)", kind: "number", unit: "pcs" },
      { variant: "Chequered Plate (MS)", kind: "number", unit: "pcs" },
      { variant: "Safety / Car Gate Switch", kind: "number", unit: "pcs" },
      { variant: "Home Safety Switch", kind: "number", unit: "pcs" },
      { variant: "PVC Cable Hanger", kind: "number", unit: "pcs" },
      { variant: "Ret. Cam", kind: "number", unit: "pcs" },
      { variant: "Reed Channel", kind: "number", unit: "pcs" },
      { variant: "Fan Grill Square", kind: "number", unit: "pcs" },
      { variant: "Fan Grill Blower", kind: "number", unit: "pcs" },
      { variant: "Fireman Switch", kind: "number", unit: "pcs" },
      { variant: "Oil Pot", kind: "number", unit: "pcs" },
      { variant: "Mobil T-40", kind: "number", unit: "pcs" },
      { variant: "Grease 200grm", kind: "number", unit: "pcs" },
      { variant: "Safety Tips Plate", kind: "number", unit: "pcs" },
      { variant: "Danger Plate", kind: "number", unit: "pcs" },
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
