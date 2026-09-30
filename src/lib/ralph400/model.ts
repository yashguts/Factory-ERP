/* ------------------------------------------------------------------
   RALPH 400 — BOM model

   TypeScript port of `web/model.js` from the RALPH400_BOM repo, which is
   itself a faithful port of Sheet2 of "RALPH 400 BOM.xlsx" (post-fix). Since
   2026-09-29 the workbook carries the owner's revision R1.
   The numbers this file produces are the numbers the workbook produces —
   do not "tidy" a formula here without re-checking it against the sheet.

   Fixes already applied in the workbook and carried here:
     * R19/T19/R20/T20  E5-200 -> C4-200   (E5 was a blank cell)
     * P19/L20/N20/P20  C5-200 -> C4-200   (front/back faces span the width)
     * L19              C4-135 -> C4-200   (rows 17-20 are now uniform at -200)
     * 89 level cells gated on their own floor-height input, so a floor
       that does not exist yields blank instead of a negative length.
     * H32/H33  "NO"-1 gave #VALUE! for CWT=BACK; the -1 now sits inside.
     * G30      tested C20 (an empty cell) instead of C15.

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
  doorOpening: "AT 700 R",
};

/* doorOpening follows the owner's R1 dropdown on C17. As typed there, stray
   commas split three entries into fragments ("800 L,  AT", "600L, SW", ...);
   this is the list those entries read as whole. The value only labels the
   D-locking door post, so no quantity depends on it. */
export const OPTIONS = {
  cwt: ["BACK", "RIGHT", "LEFT"],
  doorType: ["AT", "ACO", "SWING", "MCD"],
  doorOpening: [
    "AT 600 R", "AT 700 R", "AT 800 R", "AT 600 L", "AT 700 L", "AT 800 L",
    "600 CO", "700 CO", "800 CO", "600L SW", "700L SW", "800L SW",
  ],
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
    cell: "I26 / I29 / I39",
    what: "Left/right channels, CWT=BACK",
    sheet: "C4-200 (+40)",
    clean: "C5-200 (+40)",
    note: "A left- or right-hand channel spans the depth (C5), and does in every other branch; I25 and I28, the 170 channels these covers sit on, always use C5, and I40, the right-hand twin of I39, uses C5. The owner fixed this exact pattern in the glass row I65 in R1; these three still use the width (C4) when CWT=BACK.",
  },
  {
    cell: "I29",
    what: "HZ CH COVER RIGHT 170, CWT=LEFT",
    sheet: "C5-200",
    clean: "C5-200+40",
    note: "R1 made every cover length its channel length +40 (I26, I31, I33, I36, I38, I45, I47, I49, and I29's own BACK branch). This branch alone has no +40.",
  },
  {
    cell: "G37",
    what: "HZ CHANNEL 135 RIGHT bracket flag",
    sheet: "(none)",
    clean: "BRACKET when CWT=RIGHT",
    note: "R1 added G35 so the LEFT 135 channel is flagged BRACKET on the counterweight side, as the BACK one (G32) already was. G37, the RIGHT one, was not given the same flag.",
  },
  {
    cell: "T8:T11",
    what: "4RT QTY on the corner verticals",
    sheet: "=C8",
    clean: "1",
    note: "Every other level QTY on these rows is a hardcoded 1.",
  },
  {
    cell: "I41 / I42",
    what: "Top channel BACK / FRONT, CWT=BACK",
    sheet: "NO (length)",
    clean: "C4-200",
    note: "Both rows keep a quantity when CWT=BACK (H41 even says \"BRACKET, 1\") but their length reads NO, so the top frame is left open at the back and front. The front never changes with the counterweight elsewhere (I48 is always C4-200).",
  },
  {
    cell: "H69 / I69",
    what: "SHEET CLADDING LEFT COMMON, CWT≠LEFT",
    sheet: "qty 2F, length \"GLASS\"",
    clean: "NO",
    note: "That face is glass, already counted in the glass rows, so 2F left sheets would be extra. The owner changed the matching rows 70/71 from \"GLASS\" to \"NO\"; row 69 was missed.",
  },
  {
    cell: "H62:H67, H70, H71",
    what: "Console glass/cladding quantities",
    sheet: "flat 1 / 2F-1 / 2F",
    clean: "NO where the length is NO",
    note: "The quantity column ignores the counterweight while the length column follows it, so faces without that panel still list pieces (24 extra on the workbook's own sample job).",
  },
  {
    cell: "N15",
    what: "1ST glass BACK width, CWT=RIGHT",
    sheet: "NO",
    clean: "C4-200+35",
    note: "The 1ST back glass has a height (M15) but no width when CWT=RIGHT, so the panel drops out; every other level has glass there.",
  },
  {
    cell: "T15",
    what: "4RT glass BACK width",
    sheet: "C4-135",
    clean: "C4-200+35",
    note: "Every other glass width is face-200+35; this one is 30 mm wider. Present since the original workbook.",
  },
  {
    cell: "T13",
    what: "4RT glass-left WIDTH",
    sheet: "(cell missing)",
    clean: "C5-200+35",
    note: "S13 computes a 4th-floor height but the matching width cell was never created, so the panel has no width.",
  },
  {
    cell: "H39 / H41",
    what: "Top-channel QTY",
    sheet: '" 1" / "BRACKET,  1"',
    clean: "bracket flag + 1",
    note: "Text in a quantity column. H40 was cleaned to \"1\" on 2026-09-23; H39 still holds a leading space and H41 still holds prose. Both views split these into a BRACKET tag and a numeric 1 so the column stays summable.",
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
    {
      desc: "GLASS 6MM BACK EXTN",
      off: 100,
      skipWhen: B,
      // AUDIT N15 (no width when CWT=RIGHT) and T15 (C4-135) in sheet mode.
      w: (k) => (strict ? (k === 4 ? W - 135 : k === 1 && R ? -1 : W - 200 + 35) : W - 200 + 35),
    },
    {
      desc: "SHEET CLADDING 1.2MM LEFT EXTN",
      off: 135,
      onlyWhen: L,
      w: () => D - 200,
      ohW: D - 200,
    },
    {
      desc: "SHEET CLADDING 1.2MM RIGHT EXTN",
      off: 135,
      onlyWhen: R,
      w: () => D - 200,
      ohW: D - 200,
    },
    {
      desc: "SHEET CLADDING 1.2MM BACK EXTN",
      off: 135,
      onlyWhen: B,
      w: () => W - 200,
      ohW: W - 200,
    },
    {
      desc: "SHEET CLADDING 1.2MM FRONT EXTN",
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
    // U17:V20 carry no CWT condition: the overhead is sheet-clad on all four
    // faces for every job (the glass rows have no overhead cells), in both modes.
    const ohActive = "ohW" in d;
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

  /* ---------------- horizontal channels (rows 25-50) ----------------
     Laid out as the owner's R1 revision (2026-09-29): every channel that has a
     sheet cover now has its own COVER (1.2MM) row, and every cover length is
     the channel length +40. A cover reads "NO" on the counterweight side, where
     the channel is a bracket instead. Text quantities in the sheet ("1", " 1")
     are normalised to numbers so the column stays summable. */
  function pick<T>(l: T, b: T, r: T): T | "" {
    return L ? l : B ? b : R ? r : "";
  }
  // AUDIT I26/I29/I39: with CWT=BACK these left/right parts use the width (C4).
  const sideB = strict ? W - 200 : D - 200;
  const channels: ChannelRow[] = [
    { desc: "HZ CHANNEL LEFT 170", br: L, qty: 1, len: D - 200 }, // row 25
    {
      desc: "HZ CH LEFT COVER 170 (1.2MM)",
      qty: pick<Figure>(NA, 1, 1),
      len: pick<Figure>(NA, sideB + 40, D - 200 + 40),
    },
    { desc: "HZ SILL CHANNEL 142", qty: F, len: W - 200 },
    { desc: "HZ CHANNEL RIGHT 170", br: R, qty: 1, len: D - 200 },
    {
      // AUDIT I29: the LEFT branch alone has no +40.
      desc: "HZ CH COVER RIGHT 170",
      qty: pick<Figure>(1, 1, NA),
      len: pick<Figure>(strict ? D - 200 : D - 200 + 40, sideB + 40, NA),
    },
    // G30 tested C20 as written in R1; fixed to C15 in the workbook.
    { desc: "HZ CHANNEL 170 BACK", br: B, qty: 1, len: W - 200 }, // row 30
    { desc: "HZ CH BACK COVER 170 (1.2MM)", qty: pick<Figure>(1, NA, 1), len: W - 200 + 40 },
    {
      // R1 changed this quantity from 3F to 3F-1, but wrote the -1 outside the
      // IF, so CWT=BACK gave "NO"-1 = #VALUE!. Fixed in the workbook (fix 9).
      desc: "HZ CHANNEL 135 BACK (1.5MM)",
      br: B,
      qty: pick<Figure>(F * 3 - 1, NA, F * 3 - 1),
      len: pick<Figure>(W - 200, NA, W - 200),
    },
    {
      desc: "HZ CHANNEL 135 BACK COVER (1.2MM)",
      qty: pick<Figure>(F * 3 - 1, NA, F * 3 - 1),
      len: pick<Figure>(W - 200 + 40, NA, W - 200 + 40),
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
      br: L,
      qty: pick<Figure>(NA, F * 3 - 1, F * 3 - 1),
      len: pick<Figure>(NA, D - 200, D - 200),
    },
    {
      desc: "HZ CHANNEL 135 LEFT COVER (1.2MM)",
      qty: pick<Figure>(NA, F * 3 - 1, F * 3 - 1),
      len: pick<Figure>(NA, D - 200 + 40, D - 200 + 40),
    },
    {
      // AUDIT G37: no BRACKET flag in the sheet, unlike its LEFT and BACK twins.
      desc: "HZ CHANNEL 135 RIGHT (1.5MM)",
      br: !strict && R,
      qty: pick<Figure>(F * 3 - 1, F * 3 - 1, NA),
      len: pick<Figure>(D - 200, D - 200, NA),
    },
    {
      desc: "HZ CHANNEL 135 RIGHT COVER (1.2MM)",
      qty: pick<Figure>(F * 3 - 1, F * 3 - 1, NA),
      len: pick<Figure>(D - 200 + 40, D - 200 + 40, NA),
    },
    {
      desc: "HZ TOP CHANNEL LEFT (3MM)",
      br: L,
      qty: 1,
      len: pick<Figure>(D - 200, sideB, D - 200),
    },
    { desc: "HZ TOP CHANNEL RIGHT (3MM)", br: R, qty: 1, len: D - 200 },
    {
      // AUDIT I41/I42: the sheet drops these lengths when CWT=BACK.
      desc: "HZ TOP CHANNEL BACK (3MM)",
      br: B,
      qty: 1,
      len: pick<Figure>(W - 200, strict ? NA : W - 200, W - 200),
    },
    {
      desc: "HZ TOP CHANNEL FRONT (3MM)", // row 42
      qty: 1,
      len: pick<Figure>(W - 200, strict ? NA : W - 200, W - 200),
    },
    { desc: "HZ 2ND LAST CHANNEL 135 MM LEFT", br: L, qty: 1, len: D - 200 }, // row 44
    { desc: "HZ 2ND LAST CHANNEL COVER 135 MM LEFT", qty: pick<Figure>(NA, 1, 1), len: D - 200 + 40 },
    { desc: "HZ 2ND LAST CHANNEL 135 MM RIGHT", br: R, qty: 1, len: D - 200 },
    { desc: "HZ 2ND LAST CHANNEL COVER 135 MM RIGHT", qty: pick<Figure>(1, 1, NA), len: D - 200 + 40 },
    { desc: "HZ 2ND LAST CHANNEL 135 MM FRONT", qty: 1, len: W - 200 },
    { desc: "HZ 2ND LAST CHANNEL COVER 135 MM BACK", qty: pick<Figure>(1, NA, 1), len: W - 200 + 40 },
    { desc: "HZ 2ND LAST CHANNEL 135 MM BACK", br: B, qty: 1, len: W - 200 }, // row 50
  ];

  /* ---------------- 2450 console module (rows 54-71) ---------------- */
  const console2450: ConsoleRow[] = [
    { dwg: "D100-0001", desc: "FRONT LEFT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D101-0001", desc: "FRONT RIGHT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D102-0001", desc: "BACK LEFT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D103-0001", desc: "BACK RIGHT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { desc: "HZ CHANNEL SILL 142", qty: F, len: W - 200 },
    /* AUDIT H62:H71. The owner's workbook gates only the length (column I)
       and leaves column H a flat 1 / 2*C8-1 / 2*C8, so a face with no glass
       still ships a quantity. Sheet mode reproduces that; clean mode gates the
       quantity with the length.
       SHEET CLADDING LEFT (H69) is gated in clean mode only (AUDIT H69): on a
       glass face its "GLASS" pieces are already counted in the glass rows. */
    {
      desc: "GLASS BACK COMMON 1098 X (1ST)",
      qty: strict ? 1 : pick<Figure>(1, NA, 1),
      len: pick<Figure>(W - 200 + 35, NA, W - 200 + 35),
    },
    {
      desc: "GLASS LEFT COMMON 1098 X (1ST)",
      qty: strict ? 1 : pick<Figure>(NA, 1, 1),
      len: pick<Figure>(NA, D - 200 + 35, D - 200 + 35),
    },
    {
      desc: "GLASS RIGHT COMMON 1098 X (1ST)",
      qty: strict ? 1 : pick<Figure>(1, 1, NA),
      len: pick<Figure>(D - 200 + 35, D - 200 + 35, NA),
    },
    {
      // I65 measured this against C4 when CWT=BACK; the owner fixed it to C5 in R1.
      desc: "GLASS LEFT COMMON 1128 X",
      qty: strict ? 2 * F - 1 : pick<Figure>(NA, 2 * F - 1, 2 * F - 1),
      len: pick<Figure>(NA, D - 200 + 35, D - 200 + 35),
    },
    {
      desc: "GLASS RIGHT COMMON 1128 X",
      qty: strict ? 2 * F - 1 : pick<Figure>(2 * F - 1, 2 * F - 1, NA),
      len: pick<Figure>(D - 200 + 35, D - 200 + 35, NA),
    },
    {
      desc: "GLASS BACK COMMON 1128 X",
      qty: strict ? 2 * F - 1 : pick<Figure>(2 * F - 1, NA, 2 * F - 1),
      len: pick<Figure>(W - 200 + 35, NA, W - 200 + 35),
    },
    {
      desc: "SHEET CLADDING LEFT COMMON 1.2MM 1090MM",
      qty: strict ? 2 * F : pick<Figure>(2 * F, NA, NA),
      len: strict ? pick<Figure | "GLASS">(D - 200, "GLASS", "GLASS") : pick<Figure>(D - 200, NA, NA),
    },
    {
      // R1's F70 reads "SHEET CLADDING COMMON" — the rename dropped RIGHT.
      desc: "SHEET CLADDING RIGHT COMMON 1.2MM 1090MM",
      qty: strict ? 2 * F : pick<Figure>(NA, NA, 2 * F),
      len: pick<Figure>(NA, NA, D - 200),
    },
    {
      desc: "SHEET CLADDING BACK COMMON 1.2MM 1090MM",
      qty: strict ? 2 * F : pick<Figure>(NA, 2 * F, NA),
      len: pick<Figure>(NA, W - 200, NA),
    },
  ];

  /* ---------------- doors, brackets, fasteners (rows 74-92) ---------------- */
  const hardware: HardwareRow[] = [
    { desc: "DOOR POST  D LOCKING R", tag: inp.doorOpening, qty: F },
    { desc: "DOOR POST CLADING R", qty: F },
    { desc: "LINTEL PANEL  R", qty: F },
    { desc: "DOOR POST  D LOCKING L", qty: F },
    { desc: "DOOR POST CLADING L", qty: F },
    { desc: "LINTEL PANEL  L", qty: F },
    { desc: "HEADER BRACKET CHANNEL", qty: F },
    // Added in R1. The 122 plate is a flat 2 whatever the floor count.
    { desc: "BRACKET FIXING PLATE 122", qty: 2 },
    { desc: "BRACKET FIXING PLATE 124", qty: F * 3 * 2 - 2 },
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
