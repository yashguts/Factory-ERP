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
  | { kind: "driveType"; drives: string[] }
  | { kind: "driveTypeExclude"; drives: string[] };

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
    gate: { kind: "driveTypeExclude", drives: ["HYD"] },
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
    description: "Counter bracket types (1-4). Shown for MR and Hydraulic drives.",
    gate: { kind: "driveType", drives: ["MR", "HYD"] },
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
    description: "Safety gear, pulleys, counter frame, guard net and machine beams.",
    gate: ALWAYS,
    fullWidth: true,
    customEditor: "safety",
    leaves: [
      { variant: "Type", kind: "select", options: ["Goods", "Home", "MRL", "R1", "R1/150", "Standard", "Belt", "Cantilever", "Hydraulic"] },
      { variant: "DBG", kind: "text" },
      { variant: "Main Pulley Specifications", kind: "select", options: ["200/4G/6", "300/4G/8", "300/5G/8", "300/6G/8", "300/7G/8", "300/8G/8", "320/6G/8", "400/10G/8", "400/6G/8", "400/7G/8", "400/8G/10", "400/8G/8", "500/4G/13", "500/3G/13", "200/3G/13", "400/5G/8", "500/6G/8", "200/4G/6/PVC", "300/4G/8/PVC", "300/6G/8/PVC", "300/7G/8/PVC", "400/4G/8", "400/3G/13"] },
      { variant: "Main Pulley Quantity", kind: "number", unit: "pcs" },
      { variant: "Counter Pulley Specifications", kind: "select", options: ["200/4G/6", "300/4G/8", "300/5G/8", "300/6G/8", "300/7G/8", "300/8G/8", "320/6G/8", "400/10G/8", "400/6G/8", "400/7G/8", "400/8G/10", "400/8G/8", "500/4G/13", "500/3G/13", "200/3G/13", "400/5G/8", "500/6G/8", "200/4G/6/PVC", "300/4G/8/PVC", "300/6G/8/PVC", "300/7G/8/PVC", "400/4G/8", "400/3G/13"] },
      { variant: "Counter Pulley Quantity", kind: "number", unit: "pcs" },
      { variant: "Diverter Pulley Specifications", kind: "select", options: ["200/4G/6", "300/4G/8", "300/5G/8", "300/6G/8", "300/7G/8", "300/8G/8", "320/6G/8", "400/10G/8", "400/6G/8", "400/7G/8", "400/8G/10", "400/8G/8", "500/4G/13", "500/3G/13", "200/3G/13", "400/5G/8", "500/6G/8", "200/4G/6/PVC", "300/4G/8/PVC", "300/6G/8/PVC", "300/7G/8/PVC", "400/4G/8", "400/3G/13"] },
      { variant: "Diverter Pulley Quantity", kind: "number", unit: "pcs" },
      { variant: "Counter Frame Rope/Belt", kind: "select", options: ["Rope", "Belt"] },
      { variant: "Counter Frame Type", kind: "select", options: ["550 (Home)", "650 (Home)", "750 (Home)", "850 (Home)", "710 S", "850 S", "1050 S", "710 M", "850 M", "1050 M", "1050 G", "1350 G", "1750 G", "1550 G", "2450 G"] },
      { variant: "Counter Frame Quantity", kind: "number", unit: "pcs" },
      { variant: "Counter Guard Net Type", kind: "select", options: ["550 (Home)", "650 (Home)", "750 (Home)", "850 (Home)", "710 S", "850 S (50)", "850 S (65)", "1050 S", "1050 S (50)", "1050 S (65)", "1050 G", "1350 G", "1750 G", "1550 G", "2450 G"] },
      { variant: "Counter Guard Net Quantity", kind: "number", unit: "pcs" },
      { variant: "Pit Ladder Quantity", kind: "number", unit: "pcs" },
      { variant: "Machine Beam Home", kind: "select", options: ["550R", "650R", "750R", "850R", "550B", "650B", "750B", "850B"] },
      { variant: "Machine Beam 2:1", kind: "select", options: ["620R1", "710", "710R1", "850", "850R1", "850/65R1", "1050/50R1 8P", "1050/65R1", "1050/65R1 13P", "1050/65R1 16P"] },
      { variant: "Machine Beam 4:1", kind: "select", options: ["1050/65", "1550/65", "2450/65"] },
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
    fullWidth: true,
    customEditor: "filler-weight",
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
    customEditor: "machine",
    leaves: [
      { variant: "Type", kind: "select", options: [
        "Machine Unit ECO Space (TRACTION)", "Machine Unit ECO Space SE-24",
        "Machine Unit 4 pass/200mm/4g/6mm/Home", "Machine Unit 6 Pass/200mm/4g/8mm",
        "Machine Unit 6 Pass/240mm/4g/8mm", "Machine Unit 6 pass/320mm/4g/8mm",
        "Machine Unit 6 pass/320mm/4g/8mm/1.5 m/s", "Machine Unit 6 pass/320mm/5g/8mm/1.75 m/s",
        "Machine Unit 8 pass/320mm/4g/8mm", "Machine Unit 8 pass/320mm/4g/8mm/1.6 m/s",
        "Machine Unit 8 pass/320mm/5g/8mm/1.75 m/s", "Machine Unit 10 Pass/240mm/5g/8mm",
        "Machine Unit 10 pass/320mm/5g/8mm", "Machine Unit 10 pass/320mm/6g/8mm/1.5 m/s",
        "Machine Unit 10 pass/320mm/6g/8mm/1.75 m/s", "Machine Unit 13 pass/320mm/6g/8mm",
        "Machine Unit 13 pass/400mm/5g/10mm/1.75 m/s", "Machine Unit 16 pass/320mm/7g/8mm",
        "Machine Unit 16 pass/320mm/6g/8mm", "Machine Unit 16 pass/485mm/6g/10mm/2.5 m/s",
        "Machine Unit 20 Pass/320mm/8g/8mm", "Machine Unit 20 Pass/320mm/8g/8mm/1.5 m/s",
        "Machine Unit 20 Pass/320mm/8g/8mm/1.75 m/s", "Machine Unit 20 Pass/320mm/8g/8mm/2.5 m/s",
        "Machine Unit 26 Pass/320mm/10g/8mm", "Machine Unit 26 Pass/480mm/10g/8mm",
        "Machine Unit 1250kg/320mm/9g/8mm", "Machine Unit 2500kg/320mm/9g/8mm/2.0 m/s",
        "Machine Unit 1600kg/320mm/10g/8mm", "Machine Unit 2000kg/320mm/10g/8mm",
        "Machine Unit 4 pass/100mm/2g/30mm/Home BELT",
        "Machine Unit Belt 13 Pass/6.8 KW/1.0M/S", "Machine Unit Belt 20 Pass/6.8 KW/1.0M/S",
        "Machine Unit 3 HP/DRUM-TYPE",
        "Machine Unit 5 HP/530mm/3g/10mm/940rpm/0.65 m/s (STELLAR)",
        "Machine Unit 6 HP/530mm/3g/13mm/1440rpm/1.0 m/s (STELLAR)",
        "Machine Unit 7.5 HP/530mm/3g/13mm/1440rpm (V3F)",
        "Machine Unit 10 HP/610mm/4g/13mm/1440rpm (V3F)",
        "Machine Unit 12.5 HP/610mm/4g/13mm/1440rpm (V3F)",
        "Machine Unit 12.5 HP/610mm/4g/13mm/1440rpm (V3F)/1.5m/s",
        "Machine Unit 15 HP/610mm/4g/13mm/1440rpm (V3F)",
        "Machine Unit 20 HP/610mm/6g/13mm/1440rpm (V3F)",
      ] },
    ],
  },
  {
    category: "Governor",
    phase: "Drive / Machine / Governor",
    gate: ALWAYS,
    customEditor: "governor",
    leaves: [
      { variant: "Type", kind: "select", options: ["HOME", "1/LH R1", ".5/LH", "0.7/LH R1", ".35/RH", "1/RH", "1.5/LH R1", ".5/LH/RH", "SE-24", "HYD-6P", "1.88 TRP", ".5/RH", "0.5/RH", "0.7/LH", ".7/RH", "1/LH", "1/RH R1", "1.25/RH", "1.5/LH", "1.5/RH", "2.5/LH"] },
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
    fullWidth: true,
    customEditor: "cabin-items",
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
