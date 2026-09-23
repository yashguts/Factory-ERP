/* ------------------------------------------------------------------
   RALPH 400 — BOM model

   TypeScript port of `web/model.js` from the RALPH400_BOM repo, which is
   itself a faithful port of Sheet2 of "RALPH 400 BOM.xlsx" (post-fix).
   The numbers this file produces are the numbers the workbook produces —
   do not "tidy" a formula here without re-checking it against the sheet.

   Fixes already applied in the workbook and carried here:
     * R19/T19/R20/T20  E5-200 -> C4-200   (E5 was a blank cell)
     * P19/L20/N20/P20  C5-200 -> C4-200   (front/back faces span the width)
     * L19              C4-135 -> C4-200   (rows 17-20 are now uniform at -200)
     * 89 level cells gated on their own floor-height input, so a floor
       that does not exist yields blank instead of a negative length.

   App-only rule, NOT in the workbook: any cell that would carry a negative
   length or quantity reads "NO" instead. The sheet leaves those cells blank.
   See nn() below; this is the one place the app deliberately differs.

   Remaining source drift is NOT silently corrected. It is reproduced
   as-is in "sheet" mode and listed in AUDIT; "clean" mode applies the
   consistent value instead.
   ------------------------------------------------------------------ */

/** Token for a part that does not apply, or whose figure would be negative. */
export const NA = "NO";

export const LEVELS = ["PIT", "GND", "1ST", "2ND", "3RD", "4RT", "OVERHEAD"] as const;

export type Mode = "sheet" | "clean";
export type Cwt = "BACK" | "RIGHT" | "LEFT";

export interface Ralph400Inputs {
  jobNo: string;
  shaftWidth: number; // C4  external width
  shaftDepth: number; // C5  external depth
  pitHeight: number; // C6
  overHead: number; // C7
  floors: number; // C8
  h1: number; // C9   bottom -> 1st
  h2: number; // C10  1st -> 2nd
  h3: number; // C11  2nd -> 3rd
  h4: number; // C12  3rd -> 4th
  h5: number; // C13  4th -> 5th
  cwt: string; // C15
  doorType: string; // C16 (unused by the sheet, carried for the job record)
  doorOpening: string; // C17
}

export const DEFAULTS: Ralph400Inputs = {
  jobNo: "BLR 94",
  shaftWidth: 1600,
  shaftDepth: 1650,
  pitHeight: 345,
  overHead: 3200,
  floors: 3,
  h1: 3350,
  h2: 3310,
  h3: 0,
  h4: 0,
  h5: 0,
  cwt: "BACK",
  doorType: "AT",
  doorOpening: "700 R",
};

export const OPTIONS = {
  cwt: ["BACK", "RIGHT", "LEFT"],
  doorType: ["AT", "ACO", "SWING", "MCD"],
  doorOpening: ["600 R", "700 R", "800 R", "600 L", "700 L", "800 L"],
} as const;

export interface AuditRow {
  cell: string;
  what: string;
  sheet: string;
  clean: string;
  note: string;
}

/** Cells where the workbook still disagrees with its own row/column rule. */
export const AUDIT: AuditRow[] = [
  {
    cell: "I56",
    what: "GLASS LEFT COMMON 1128, CWT=BACK",
    sheet: "C4-200+35",
    clean: "C5-200+35",
    note: "A left-hand panel spans the depth (C5). Row 57, its right-hand twin, uses C5.",
  },
  {
    cell: "H29",
    what: "HZ CH COVER RIGHT 170 - QTY",
    sheet: "(blank)",
    clean: "1",
    note: "Length is computed but the quantity cell was never filled in.",
  },
  {
    cell: "T8:T11",
    what: "4RT QTY on the corner verticals",
    sheet: "=C8",
    clean: "1",
    note: "Every other level QTY on these rows is a hardcoded 1.",
  },
  {
    cell: "U17:V20",
    what: "Overhead segment of the sheet covers",
    sheet: "always computed",
    clean: "follows the CWT rule",
    note: "U and V carry no CWT condition, so the left-cover row still emits an overhead panel when every other level of that row reads \"NO\".",
  },
  {
    cell: "T13",
    what: "4RT glass-left WIDTH",
    sheet: "(cell missing)",
    clean: "C5-200+35",
    note: "S13 computes a 4th-floor height but the matching width cell was never created, so the panel has no width.",
  },
  {
    cell: "H35 / H36",
    what: "Top-channel QTY",
    sheet: '"BRACKET 3MM,   1"',
    clean: "bracket flag + 1",
    note: "Text in a quantity column. Both views split this into a BRACKET tag and a numeric 1 so the column stays summable.",
  },
];

/* Geometry constants that set the minimum usable floor-to-floor height. */
export const MODULE_H = 2450; // the fixed console module
export const COVER_OFF = 135; // sheet-cover offset taken off the extension
export const TOP_EXTRA = 35; // extra drop carried only by the 4RT row (S8)

const isNum = (v: unknown): v is number =>
  typeof v === "number" && isFinite(v);

/* A length or a quantity that comes out negative is not a part anyone can make.
   Report it as "NO" — the token the sheet already uses for a part that does not
   apply — rather than letting a negative number into the BOM. */
function nn<T>(v: T): T | typeof NA {
  return isNum(v) && v < 0 ? NA : v;
}

export type FloorKey = "h1" | "h2" | "h3" | "h4" | "h5";

export const FLOOR_FIELDS: [FloorKey, string][] = [
  ["h1", "Bottom → 1st"],
  ["h2", "1st → 2nd"],
  ["h3", "2nd → 3rd"],
  ["h4", "3rd → 4th"],
  ["h5", "4th → 5th"],
];

/** Extra height this level loses before the extension starts. */
function levelPad(key: FloorKey, inp: Ralph400Inputs): number {
  if (key === "h1") return inp.pitHeight >= 170 ? 0 : 170 - inp.pitHeight;
  if (key === "h5") return TOP_EXTRA;
  return 0;
}

/**
 * Minimum usable floor-to-floor height for a level. Below this the panel rows
 * would cut past zero, so the workbook blanks the whole level. Mirrors the
 * sheet gates: 2585, 2620 for 4RT, 2585+(170-pit) for GND.
 */
export function minHeight(key: FloorKey, inp: Ralph400Inputs): number {
  return MODULE_H + COVER_OFF + levelPad(key, inp);
}

export interface Issue {
  key: FloorKey;
  level: "error" | "warn";
  label: string;
  msg: string;
}

/**
 * Input problems worth showing the user. Every one of these means the level
 * carries no parts; its cells read "NO".
 */
export function validate(inp: Ralph400Inputs): Issue[] {
  const out: Issue[] = [];
  FLOOR_FIELDS.forEach(([key, label]) => {
    const v = inp[key];
    if (!isNum(v) || v <= 0) return; // level simply not used
    const lim = minHeight(key, inp);
    if (v >= lim) return;
    const ext = v - MODULE_H - levelPad(key, inp);
    const msg =
      v < MODULE_H
        ? `${v} mm is below the ${MODULE_H} mm console module.`
        : `leaves only ${ext} mm of extension; the panel rows need ${COVER_OFF} mm, so ${lim} mm is the minimum.`;
    out.push({
      key,
      level: "error",
      label,
      msg: msg + " This level is marked NO in the BOM.",
    });
  });
  return out;
}

/** A single figure in a table: a number, the "NO" token, or nothing at all. */
export type Figure = number | typeof NA | "" | null;

/** One cell of the glass/sheet panel grid. */
export type PanelCell =
  | null // no panel at this level (PIT, or row carries no overhead)
  | { na: true } // level not built / too short / figure would be negative
  | { h: number; w: number | null }; // w === null: the workbook cell was never created

export interface VerticalRow {
  desc: string;
  cells: Figure[];
  /**
   * Per-level quantity. NB: carried from the source model but NOT rendered —
   * the original app hardcodes "1" in the Qty/level column, so the T8:T11
   * drift in AUDIT is computed here and never shown. Preserved rather than
   * fixed, so this port changes no figure the owner sees today.
   */
  qty: Figure[];
}

export interface PanelRow {
  desc: string;
  cells: PanelCell[];
}

export interface ChannelRow {
  desc: string;
  br?: boolean;
  tag?: string;
  qty: Figure;
  len: Figure;
}

export interface ConsoleRow {
  dwg?: string;
  desc: string;
  qty: Figure;
  len: Figure | "GLASS";
}

export interface HardwareRow {
  desc: string;
  tag?: string;
  qty: Figure;
}

export interface Ralph400Result {
  verticals: VerticalRow[];
  panels: PanelRow[];
  channels: ChannelRow[];
  console2450: ConsoleRow[];
  hardware: HardwareRow[];
  activeLevels: boolean[];
  vert: Figure[];
  pitExt: Figure;
  ohExt: Figure;
  ohPanelH: Figure;
  liveFloors: number;
}

interface PanelDef {
  desc: string;
  off: number;
  skipWhen?: boolean;
  onlyWhen?: boolean;
  w: (k: number) => number | null;
  ohW?: number;
}

export function compute(inp: Ralph400Inputs, mode: Mode): Ralph400Result {
  const strict = mode !== "clean";
  const W = inp.shaftWidth,
    D = inp.shaftDepth;
  const pit = inp.pitHeight,
    oh = inp.overHead,
    F = inp.floors;
  const cwt = inp.cwt;
  const L = cwt === "LEFT",
    B = cwt === "BACK",
    R = cwt === "RIGHT";

  const hts = [inp.h1, inp.h2, inp.h3, inp.h4, inp.h5]; // GND 1ST 2ND 3RD 4RT
  // A level is live only when its height clears that level's own minimum.
  // Mirrors the workbook gates exactly, so app and sheet agree.
  const on = hts.map(
    (h, i) => isNum(h) && h >= minHeight(FLOOR_FIELDS[i][0], inp),
  );

  /* ---- corner vertical extension per level (Sheet2 rows 8-11) ---- */
  const pitExt = nn(pit >= 170 ? pit - 95.5 : 74.5);
  // A level that is not built, or whose extension would be negative, reads "NO".
  const vert: Figure[] = [
    on[0]
      ? nn(pit >= 170 ? hts[0] - 2450 : hts[0] - 2450 - (170 - pit))
      : NA,
    on[1] ? nn(hts[1] - 2450) : NA,
    on[2] ? nn(hts[2] - 2450) : NA,
    on[3] ? nn(hts[3] - 2450) : NA,
    on[4] ? nn(hts[4] - 2450 - 35) : NA,
  ];
  // Neither of these sits under a level gate, so they carry their own check.
  const ohExt = nn(oh + 67.5 - 2450 - 30); // U8..U11
  const ohPanelH = nn(oh - 2422 - 170); // U17..U20

  /* ---------------- corner verticals ---------------- */
  const vertNames = [
    "FRONT LEFT VERTICAL EXTN",
    "FRONT RIGHT VERTICAL EXTN",
    "BACK LEFT VERTICAL EXTN",
    "BACK RIGHT VERTICAL EXTN",
  ];
  const verticals: VerticalRow[] = vertNames.map((desc) => ({
    desc,
    cells: ([pitExt] as Figure[]).concat(vert).concat([ohExt]),
    qty: [1, 1, 1, 1, 1, strict ? F : 1, 1],
  }));

  /* ---------------- glass & sheet panels (rows 13-20) ---------------- */
  const panelDefs: PanelDef[] = [
    {
      desc: "GLASS 6MM LEFT EXTN",
      off: 100,
      skipWhen: L,
      w: (k) => (strict && k === 4 ? null : D - 200 + 35), // T13 never created
    },
    { desc: "GLASS 6MM RIGHT EXTN", off: 100, skipWhen: R, w: () => D - 200 + 35 },
    { desc: "GLASS 6MM BACK EXTN", off: 100, skipWhen: B, w: () => W - 200 + 35 },
    {
      desc: "SHEET COVER 1.2MM LEFT EXTN",
      off: 135,
      onlyWhen: L,
      w: () => D - 200,
      ohW: D - 200,
    },
    {
      desc: "SHEET COVER 1.2MM RIGHT EXTN",
      off: 135,
      onlyWhen: R,
      w: () => D - 200,
      ohW: D - 200,
    },
    {
      desc: "SHEET COVER 1.2MM BACK EXTN",
      off: 135,
      onlyWhen: B,
      w: () => W - 200,
      ohW: W - 200,
    },
    {
      desc: "SHEET COVER 1.2MM FRONT EXTN",
      off: 135,
      onlyWhen: B,
      w: () => W - 200,
      ohW: W - 200,
    },
  ];

  const panels: PanelRow[] = panelDefs.map((d) => {
    const active = "onlyWhen" in d ? !!d.onlyWhen : !d.skipWhen;
    const cells: PanelCell[] = [null]; // PIT: no panel here
    for (let k = 0; k < 5; k++) {
      if (!on[k]) {
        cells.push({ na: true }); // floor not built
        continue;
      }
      if (!active) {
        cells.push({ na: true });
        continue;
      }
      const wv = nn(d.w(k));
      if (wv === NA) {
        cells.push({ na: true });
        continue;
      }
      const hv = nn((vert[k] as number) - d.off);
      if (!isNum(hv)) {
        cells.push({ na: true });
        continue;
      }
      cells.push({ h: hv, w: wv });
    }
    // U17:V20 carry no CWT condition in the workbook, so in "sheet" mode the
    // overhead panel is emitted even when the rest of the row is "NO".
    const ohActive = "ohW" in d && (strict || active);
    const ohW = ohActive ? nn(d.ohW) : null;
    cells.push(
      !ohActive
        ? null
        : !isNum(ohPanelH) || !isNum(ohW)
          ? { na: true }
          : { h: ohPanelH, w: ohW },
    );
    return { desc: d.desc, cells };
  });

  /* ---------------- horizontal channels (rows 25-41) ---------------- */
  function pick<T>(l: T, b: T, r: T): T | "" {
    return L ? l : B ? b : R ? r : "";
  }
  const channels: ChannelRow[] = [
    { desc: "HZ CHANNEL LEFT 170", br: L, qty: 1, len: D - 200 },
    {
      desc: "HZ CH LEFT COVER 170",
      qty: pick<Figure>(NA, 1, 1),
      len: pick<Figure>(NA, W - 200, D - 200),
    },
    { desc: "HZ SILL CHANNEL 142", qty: F, len: W - 200 },
    { desc: "HZ CHANNEL RIGHT 170", br: R, qty: 1, len: D - 200 },
    {
      desc: "HZ CH COVER RIGHT 170",
      qty: strict ? "" : 1,
      len: pick<Figure>(D - 200, W - 200, NA),
    },
    {
      desc: "HZ CHANNEL 135 BACK (1.5MM)",
      br: B,
      qty: pick<Figure>(F * 3, NA, F * 3),
      len: pick<Figure>(W - 200, NA, W - 200),
    },
    {
      desc: "HZ BRACKET CHANNEL 135 (3MM)",
      br: true,
      tag: cwt,
      qty: F * 3 - 1,
      len: pick<Figure>(D - 200, W - 200, D - 200),
    },
    {
      desc: "HZ CHANNEL 135 LEFT (1.5MM)",
      qty: pick<Figure>(NA, F * 3 - 1, F * 3 - 1),
      len: pick<Figure>(NA, D - 200, D - 200),
    },
    {
      desc: "HZ CHANNEL 135 RIGHT (1.5MM)",
      qty: pick<Figure>(F * 3 - 1, F * 3 - 1, NA),
      len: pick<Figure>(D - 200, D - 200, NA),
    },
    {
      desc: "HZ TOP CHANNEL LEFT (3MM)",
      br: L,
      qty: 1,
      len: pick<Figure>(D - 200, W - 200, D - 200),
    },
    { desc: "HZ TOP CHANNEL RIGHT (3MM)", br: R, qty: 1, len: D - 200 },
    {
      desc: "HZ TOP CHANNEL BACK (3MM)",
      br: B,
      qty: 1,
      len: pick<Figure>(W - 200, NA, W - 200),
    },
    {
      desc: "HZ TOP CHANNEL FRONT (3MM)",
      qty: 1,
      len: pick<Figure>(W - 200, NA, W - 200),
    },
    { desc: "HZ 2ND LAST CHANNEL 135X1.5MM LEFT", br: L, qty: 1, len: D - 200 },
    { desc: "HZ 2ND LAST CHANNEL 135X3MM RIGHT", br: R, qty: 1, len: D - 200 },
    { desc: "HZ 2ND LAST CHANNEL 135X1.5MM FRONT", qty: 1, len: W - 200 },
  ];

  /* ---------------- 2450 console module (rows 45-62) ---------------- */
  const console2450: ConsoleRow[] = [
    { dwg: "D100-0001", desc: "FRONT LEFT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D101-0001", desc: "FRONT RIGHT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D102-0001", desc: "BACK LEFT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D103-0001", desc: "BACK RIGHT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { desc: "HZ CHANNEL SILL 142", qty: F, len: W - 200 },
    {
      desc: "GLASS BACK COMMON 1098 X (1ST)",
      qty: 1,
      len: pick<Figure>(W - 200 + 35, NA, W - 200 + 35),
    },
    {
      desc: "GLASS LEFT COMMON 1098 X (1ST)",
      qty: 1,
      len: pick<Figure>(NA, D - 200 + 35, D - 200 + 35),
    },
    {
      desc: "GLASS RIGHT COMMON 1098 X (1ST)",
      qty: 1,
      len: pick<Figure>(D - 200 + 35, D - 200 + 35, NA),
    },
    {
      desc: "GLASS LEFT COMMON 1128 X",
      qty: 2 * F - 1,
      len: pick<Figure>(NA, strict ? W - 200 + 35 : D - 200 + 35, D - 200 + 35), // I56 drift
    },
    {
      desc: "GLASS RIGHT COMMON 1128 X",
      qty: 2 * F - 1,
      len: pick<Figure>(D - 200 + 35, D - 200 + 35, NA),
    },
    {
      desc: "GLASS BACK COMMON 1128 X",
      qty: 2 * F - 1,
      len: pick<Figure>(W - 200 + 35, NA, W - 200 + 35),
    },
    {
      desc: "SHEET COVER LEFT COMMON 1.2MM 1090MM",
      qty: 2 * F,
      len: pick<Figure | "GLASS">(D - 200, "GLASS", "GLASS"),
    },
    {
      desc: "SHEET COVER RIGHT COMMON 1.2MM 1090MM",
      qty: 2 * F,
      len: pick<Figure>(NA, NA, D - 200),
    },
    {
      desc: "SHEET COVER BACK COMMON 1.2MM 1090MM",
      qty: 2 * F,
      len: pick<Figure>(NA, W - 200, NA),
    },
  ];

  /* ---------------- doors, brackets, fasteners (rows 65-83) ---------------- */
  const hardware: HardwareRow[] = [
    { desc: "DOOR POST  D LOCKING R", tag: inp.doorOpening, qty: F },
    { desc: "DOOR POST CLADING R", qty: F },
    { desc: "LINTEL PANEL  R", qty: F },
    { desc: "DOOR POST  D LOCKING L", qty: F },
    { desc: "DOOR POST CLADING L", qty: F },
    { desc: "LINTEL PANEL  L", qty: F },
    { desc: "HEADER BRACKET CHANNEL", qty: F },
    { desc: "JOINT PLATE HEX", qty: F * 8 },
    { desc: "JOINT PLATE HOLE", qty: F * 8 },
    { desc: "RIVNUT 8", qty: 52 * F },
    { desc: "RIV NUT 5", qty: F * 203 },
    { desc: "M8 X 30 BOLT", qty: 52 * F },
    { desc: "M5 X 20 SCREW", qty: F * 203 },
    { desc: "DEAD WEIGHT CHANNEL", qty: F * 1 },
  ];

  /* Same rule for the flat tables: no negative length or quantity ships. */
  const clamp = <T extends { qty?: unknown; len?: unknown }>(r: T): T => {
    const o = { ...r };
    if ("qty" in o) o.qty = nn(o.qty);
    if ("len" in o) o.len = nn(o.len);
    return o;
  };

  const activeLevels = [true].concat(on).concat([true]);

  return {
    verticals,
    panels,
    channels: channels.map(clamp),
    console2450: console2450.map(clamp),
    hardware: hardware.map(clamp),
    activeLevels,
    vert,
    pitExt,
    ohExt,
    ohPanelH,
    liveFloors: on.filter(Boolean).length,
  };
}
