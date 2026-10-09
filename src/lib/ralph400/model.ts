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

   Owner's rules-book update (marked-up Rules Book + workbook, 2026-10-03).
   These are the owner's decided rules and apply in BOTH modes:
     * GND extension = H1 + P - 67.5 - pit piece - 2450 (workbook K8): the
       corner posts now run from the pit floor to 30 below the shaft top.
     * 4TH extension = H5 - 2450; the old -35 is gone (workbook S8).
     * Extension glass height = extension - 97 (45.5 + 45.5 rebates + 6).
     * Glass width = face span + 38 everywhere (was +35; owner confirmed +38).
     * Extension cladding height = extension - 142 (67.5 + 74.5).
     * Overhead cladding height = overhead extension - (67.5 + 135).
     * Console cladding: the lowest sheet per face is 1062 (1225 - 163),
       the other 2F - 1 are 1090.
     * Cover allowance: 170 covers = channel + 9 (4.5 + 4.5), 135 covers
       = channel + 38 (19 + 19). Was +40 for all.
     * Joint plate HEX = 12F (was 8F).
     * M8/M5 bolts, screws and rivnuts counted from per-part figures (was a
       flat 52F / 203F).
     * The 2450 module no longer repeats the sill channel; it is listed once,
       under the horizontal channels (F pieces, W - 200).

   Owner's workbook v1 ("RALPH 400 BOM_v1.xlsx", 2026-10-09), applied on top:
     * U8 overhead extension uses +95.5 (was +67.5) while K8 stays C9-2450:
       the module base sits 95.5 below each landing, so BASE_DROP = 95.5.
       This gives the owner's K8 and U8 exactly, and the posts still run from
       the pit floor to 30 below the shaft top. The overhead cladding keeps
       its height (U17 untouched), so its deduction is now 95.5 + 135.
     * Row 20: the front extension is sheet-clad on every job, not only when
       CWT=BACK. Owner v2 (K20:P20, same day): its width is C5 - 200, the
       shaft depth; height = extension - 142 as for all cladding.
     * Rows 75-77: one door set per landing (D-locking post, post cladding,
       lintel); the hand comes from the door opening (R, L, or C for CO).
     * Row 23: dead weight channel holding bracket, F per job, CO doors only.
     * Rows 24-25: pit channels, 2 front & back + 2 left & right, when the pit
       piece (I8) is over 250. The workbook gives them no length.
     * Row 22 adds a dead weight channel while row 93 keeps one; listed once.
     * The overhead ring (rows 45-51 in v1: 2nd-last channels and covers) is
       removed from the part list, on the owner's instruction the same day.

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
  /* Cell references follow the owner's workbook of 2026-10-03 (Sheet2 rows
     moved down 7 against R1). Fixed by the owner since R1 and dropped from
     this list: T8:T11 (4TH qty now 1), I33 and I46 (now use C5 when CWT=BACK). */
  {
    cell: "I36",
    what: "HZ CH COVER RIGHT 170",
    sheet: "C5-200 (CWT=LEFT) / C4-200+40 (CWT=BACK)",
    clean: "C5-200+9",
    note: "A right-hand cover spans the depth (C5) and carries the cover allowance (+9 on the 170 covers since the 2026-10-03 rules update). The LEFT branch has no allowance and the BACK branch still measures the width (C4); the owner already fixed the same slip on the left cover (I33).",
  },
  {
    cell: "G44",
    what: "HZ CHANNEL 135 RIGHT bracket flag",
    sheet: "(none)",
    clean: "BRACKET when CWT=RIGHT",
    note: "The LEFT and BACK 135 channels are flagged BRACKET on the counterweight side (G42, G39). G44, the RIGHT one, was not given the same flag.",
  },
  {
    cell: "I48 / I49",
    what: "Top channel BACK / FRONT, CWT=BACK",
    sheet: "NO (length)",
    clean: "C4-200",
    note: "Both rows keep a quantity when CWT=BACK (H48 even says \"BRACKET, 1\") but their length reads NO, so the top frame is left open at the back and front. The front never changes with the counterweight elsewhere (I55 is always C4-200).",
  },
  {
    cell: "H76 / I76",
    what: "SHEET CLADDING LEFT COMMON, CWT≠LEFT",
    sheet: "qty 2F, length \"GLASS\"",
    clean: "NO",
    note: "That face is glass, already counted in the glass rows, so the left sheets would be extra. The matching rows 77/78 read \"NO\"; row 76 still says \"GLASS\".",
  },
  {
    cell: "H69:H74, H77, H78",
    what: "Console glass/cladding quantities",
    sheet: "flat 1 / 2F-1 / 2F",
    clean: "NO where the length is NO",
    note: "The quantity column ignores the counterweight while the length column follows it, so faces without that panel still list pieces.",
  },
  {
    cell: "N22",
    what: "1ST glass BACK width, CWT=RIGHT",
    sheet: "NO",
    clean: "C4-200+35",
    note: "The 1ST back glass has a height (M22) but no width when CWT=RIGHT, so the panel drops out; every other level has glass there.",
  },
  {
    cell: "T22",
    what: "4TH glass BACK width",
    sheet: "C4-135",
    clean: "C4-200+35",
    note: "Every other glass width is face-200+35; this one is 30 mm wider. Present since the original workbook.",
  },
  {
    cell: "T20",
    what: "4TH glass-left WIDTH",
    sheet: "(cell missing)",
    clean: "C5-200+35",
    note: "S20 computes a 4th-floor height but the matching width cell was never created, so the panel has no width.",
  },
  {
    cell: "H46 / H48",
    what: "Top-channel QTY",
    sheet: '" 1" / "BRACKET,  1"',
    clean: "bracket flag + 1",
    note: "Text in a quantity column. H47 says \"BRACKET 3MM,   1\", H46 holds a leading space and H48 holds prose. Both views split these into a BRACKET tag and a numeric 1 so the column stays summable.",
  },
];

/* Geometry constants (owner's rules-book update, 2026-10-03). */
export const MODULE_H = 2450; // the fixed console module
export const BASE_DROP = 95.5; // module base below each landing (owner v1 U8, 2026-10-09; was 67.5)
export const GLASS_OFF = 97; // extension glass = extension - (45.5 + 45.5 + 6)
export const GLASS_ALLOW = 38; // glass width = face span + 38 (owner, 2026-10-03; was +35)
export const CLAD_OFF = 142; // extension cladding = extension - 142
export const OH_CLAD_OFF = BASE_DROP + 135; // overhead cladding = overhead extension - 230.5 (height unchanged by v1)
export const PIT_CHANNEL_MIN = 250; // pit channels when the pit piece is over this (v1 H24/H25)
export const COVER_170 = 9; // 170 cover = channel + 4.5 + 4.5
export const COVER_135 = 38; // 135 cover = channel + 19 + 19

const isNum = (v: unknown): v is number =>
  typeof v === "number" && isFinite(v);

/** Pit stub: P - 95.5, or a fixed 74.5 when the pit is under 170. */
export function pitPiece(pit: number): number {
  return pit >= 170 ? pit - 95.5 : 74.5;
}

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

/** Extra height this level loses before the extension starts (GND only). */
function levelPad(key: FloorKey, inp: Ralph400Inputs): number {
  if (key !== "h1") return 0;
  // GND extension = H1 + P - 95.5 - pit piece - 2450 = workbook K8:
  // H1 - 2450 with a pit of 170+, else H1 - 2450 - (170 - P).
  return BASE_DROP + pitPiece(inp.pitHeight) - inp.pitHeight;
}

/**
 * Minimum usable floor-to-floor height for a level: the extension must at
 * least hold the cladding deduction, or the panel rows cut past zero and the
 * level is blanked. 2592 for 1ST-4TH; GND 2592 with a pit of 170+, else
 * 2762 - P.
 */
export function minHeight(key: FloorKey, inp: Ralph400Inputs): number {
  return MODULE_H + CLAD_OFF + levelPad(key, inp);
}

/** Overhead must exceed this or the overhead cladding has no height. */
export const MIN_OVERHEAD = MODULE_H + 30 - BASE_DROP + OH_CLAD_OFF; // 2615

/** Hand of a door opening: "C" for centre opening (CO), "L" for a left hand, else "R". */
export function doorHand(opening: string): "R" | "L" | "C" {
  const op = (opening ?? "").toUpperCase();
  return op.includes("CO") ? "C" : op.includes("L") ? "L" : "R";
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
        : `leaves only ${ext} mm of extension; the panel rows need ${CLAD_OFF} mm, so ${lim} mm is the minimum.`;
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
  /** Per-level quantity (one piece per corner per level). Not rendered. */
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

/** A pit channel pair (v1 rows 24-25): no length in the workbook. */
export interface PitChannelRow {
  desc: string;
  face: string; // "F&B" or "L&R"
  qty: Figure;
}

export interface Ralph400Result {
  verticals: VerticalRow[];
  pitChannels: PitChannelRow[];
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
  const pitExt = nn(pitPiece(pit));
  // A level that is not built, or whose extension would be negative, reads "NO".
  const vert: Figure[] = [
    on[0] ? nn(hts[0] + pit - BASE_DROP - pitPiece(pit) - MODULE_H) : NA, // K8
    on[1] ? nn(hts[1] - MODULE_H) : NA,
    on[2] ? nn(hts[2] - MODULE_H) : NA,
    on[3] ? nn(hts[3] - MODULE_H) : NA,
    on[4] ? nn(hts[4] - MODULE_H) : NA, // S8: the old -35 is gone
  ];
  // Neither of these sits under a level gate, so they carry their own check.
  const ohExtRaw = oh + BASE_DROP - MODULE_H - 30; // U8..U11
  const ohExt = nn(ohExtRaw);
  const ohPanelH = nn(ohExtRaw - OH_CLAD_OFF); // U24..U27

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
    qty: [1, 1, 1, 1, 1, 1, 1], // T8:T11 now 1 in the workbook
  }));

  /* ---------------- glass & sheet panels (rows 13-20) ---------------- */
  const panelDefs: PanelDef[] = [
    {
      desc: "GLASS 6MM LEFT EXTN",
      off: GLASS_OFF,
      skipWhen: L,
      w: (k) => (strict && k === 4 ? null : D - 200 + GLASS_ALLOW), // T20 never created
    },
    { desc: "GLASS 6MM RIGHT EXTN", off: GLASS_OFF, skipWhen: R, w: () => D - 200 + GLASS_ALLOW },
    {
      desc: "GLASS 6MM BACK EXTN",
      off: GLASS_OFF,
      skipWhen: B,
      // AUDIT N22 (no width when CWT=RIGHT) and T22 (C4-135) in sheet mode.
      w: (k) => (strict ? (k === 4 ? W - 135 : k === 1 && R ? -1 : W - 200 + GLASS_ALLOW) : W - 200 + GLASS_ALLOW),
    },
    {
      desc: "SHEET CLADDING 1.2MM LEFT EXTN",
      off: CLAD_OFF,
      onlyWhen: L,
      w: () => D - 200,
      ohW: D - 200,
    },
    {
      desc: "SHEET CLADDING 1.2MM RIGHT EXTN",
      off: CLAD_OFF,
      onlyWhen: R,
      w: () => D - 200,
      ohW: D - 200,
    },
    {
      desc: "SHEET CLADDING 1.2MM BACK EXTN",
      off: CLAD_OFF,
      onlyWhen: B,
      w: () => W - 200,
      ohW: W - 200,
    },
    {
      // Owner v1 row 20: the front is clad on every job, whatever the CWT side.
      // Owner v2 K20:P20 (2026-10-09): height = extension - 142 (CLAD_OFF),
      // width = C5 - 200, the shaft DEPTH. The overhead front panel (V20)
      // stays C4 - 200 in the owner's sheet.
      desc: "SHEET CLADDING 1.2MM FRONT EXTN",
      off: CLAD_OFF,
      onlyWhen: true,
      w: () => D - 200,
      ohW: W - 200,
    },
  ];

  /* Pit channels (owner v1 rows 24-25): two front & back, two left & right,
     when the pit piece is over 250 (a pit deeper than 345.5). No length yet. */
  const pitQty: Figure = isNum(pitExt) && pitExt > PIT_CHANNEL_MIN ? 2 : NA;
  const pitChannels: PitChannelRow[] = [
    { desc: "HZ PIT CHANNEL F&B", face: "F&B", qty: pitQty },
    { desc: "HZ PIT CHANNEL L&R", face: "L&R", qty: pitQty },
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
     sheet cover now has its own COVER (1.2MM) row. Since the 2026-10-03 rules
     update a cover is its channel +9 on the 170 rows and +38 on the 135 rows
     (the workbook still says +40 everywhere). A cover reads "NO" on the counterweight side, where
     the channel is a bracket instead. Text quantities in the sheet ("1", " 1")
     are normalised to numbers so the column stays summable. */
  function pick<T>(l: T, b: T, r: T): T | "" {
    return L ? l : B ? b : R ? r : "";
  }
  // AUDIT I36: with CWT=BACK the right 170 cover still uses the width (C4).
  const sideB = strict ? W - 200 : D - 200;
  const channels: ChannelRow[] = [
    { desc: "HZ CHANNEL LEFT 170", br: L, qty: 1, len: D - 200 }, // row 25
    {
      desc: "HZ CH LEFT COVER 170 (1.2MM)",
      qty: pick<Figure>(NA, 1, 1),
      len: pick<Figure>(NA, D - 200 + COVER_170, D - 200 + COVER_170),
    },
    { desc: "HZ SILL CHANNEL 142", qty: F, len: W - 200 },
    { desc: "HZ CHANNEL RIGHT 170", br: R, qty: 1, len: D - 200 },
    {
      // AUDIT I36: the LEFT branch alone has no cover allowance.
      desc: "HZ CH COVER RIGHT 170",
      qty: pick<Figure>(1, 1, NA),
      len: pick<Figure>(strict ? D - 200 : D - 200 + COVER_170, sideB + COVER_170, NA),
    },
    // G30 tested C20 as written in R1; fixed to C15 in the workbook.
    { desc: "HZ CHANNEL 170 BACK", br: B, qty: 1, len: W - 200 }, // row 30
    { desc: "HZ CH BACK COVER 170 (1.2MM)", qty: pick<Figure>(1, NA, 1), len: W - 200 + COVER_170 },
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
      len: pick<Figure>(W - 200 + COVER_135, NA, W - 200 + COVER_135),
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
      len: pick<Figure>(NA, D - 200 + COVER_135, D - 200 + COVER_135),
    },
    {
      // AUDIT G44: no BRACKET flag in the sheet, unlike its LEFT and BACK twins.
      desc: "HZ CHANNEL 135 RIGHT (1.5MM)",
      br: !strict && R,
      qty: pick<Figure>(F * 3 - 1, F * 3 - 1, NA),
      len: pick<Figure>(D - 200, D - 200, NA),
    },
    {
      desc: "HZ CHANNEL 135 RIGHT COVER (1.2MM)",
      qty: pick<Figure>(F * 3 - 1, F * 3 - 1, NA),
      len: pick<Figure>(D - 200 + COVER_135, D - 200 + COVER_135, NA),
    },
    {
      desc: "HZ TOP CHANNEL LEFT (3MM)",
      br: L,
      qty: 1,
      len: D - 200,
    },
    { desc: "HZ TOP CHANNEL RIGHT (3MM)", br: R, qty: 1, len: D - 200 },
    {
      // AUDIT I48/I49: the sheet drops these lengths when CWT=BACK.
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
    // Rows 44-50, the overhead ring (2nd-last channels and their covers), were
    // removed from the part list at the owner's request on 2026-10-09; their
    // M8/M5 fasteners go with them.
  ];

  /* ---------------- 2450 console module (rows 54-71) ---------------- */
  const console2450: ConsoleRow[] = [
    { dwg: "D100-0001", desc: "FRONT LEFT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D101-0001", desc: "FRONT RIGHT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D102-0001", desc: "BACK LEFT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    { dwg: "D103-0001", desc: "BACK RIGHT VERTICAL (2450MM, 3MM THICK)", qty: F, len: 2450 },
    /* AUDIT H69:H78. The owner's workbook gates only the length (column I)
       and leaves column H a flat 1 / 2*C8-1 / 2*C8, so a face with no glass
       still ships a quantity. Sheet mode reproduces that; clean mode gates the
       quantity with the length.
       SHEET CLADDING LEFT (H76) is gated in clean mode only (AUDIT H76): on a
       glass face its "GLASS" pieces are already counted in the glass rows. */
    {
      desc: "GLASS LEFT COMMON 1098 X (1ST)",
      qty: strict ? 1 : pick<Figure>(NA, 1, 1),
      len: pick<Figure>(NA, D - 200 + GLASS_ALLOW, D - 200 + GLASS_ALLOW),
    },
    {
      desc: "GLASS RIGHT COMMON 1098 X (1ST)",
      qty: strict ? 1 : pick<Figure>(1, 1, NA),
      len: pick<Figure>(D - 200 + GLASS_ALLOW, D - 200 + GLASS_ALLOW, NA),
    },
    {
      desc: "GLASS BACK COMMON 1098 X (1ST)",
      qty: strict ? 1 : pick<Figure>(1, NA, 1),
      len: pick<Figure>(W - 200 + GLASS_ALLOW, NA, W - 200 + GLASS_ALLOW),
    },
    {
      // I65 measured this against C4 when CWT=BACK; the owner fixed it to C5 in R1.
      desc: "GLASS LEFT COMMON 1128 X",
      qty: strict ? 2 * F - 1 : pick<Figure>(NA, 2 * F - 1, 2 * F - 1),
      len: pick<Figure>(NA, D - 200 + GLASS_ALLOW, D - 200 + GLASS_ALLOW),
    },
    {
      desc: "GLASS RIGHT COMMON 1128 X",
      qty: strict ? 2 * F - 1 : pick<Figure>(2 * F - 1, 2 * F - 1, NA),
      len: pick<Figure>(D - 200 + GLASS_ALLOW, D - 200 + GLASS_ALLOW, NA),
    },
    {
      desc: "GLASS BACK COMMON 1128 X",
      qty: strict ? 2 * F - 1 : pick<Figure>(2 * F - 1, NA, 2 * F - 1),
      len: pick<Figure>(W - 200 + GLASS_ALLOW, NA, W - 200 + GLASS_ALLOW),
    },
    /* Cladding: the lowest sheet on a face is 1062 (2450/2 - 163, sitting on
       the 95.5 + 67.5 base), the other 2F - 1 are 1090 (2450/2 - 135). Until
       the 2026-10-03 rules update the workbook listed 2F at 1090. */
    ...([
      [1062, 1, "(1ST)"],
      [1090, 2 * F - 1, ""],
    ] as const).flatMap(([pane, n, tag]) => [
      {
        desc: `SHEET CLADDING LEFT COMMON 1.2MM ${pane}MM ${tag}`,
        qty: strict ? n : pick<Figure>(n, NA, NA),
        len: strict ? pick<Figure | "GLASS">(D - 200, "GLASS", "GLASS") : pick<Figure>(D - 200, NA, NA),
      },
      {
        // R1's F70 reads "SHEET CLADDING COMMON" — the rename dropped RIGHT.
        desc: `SHEET CLADDING RIGHT COMMON 1.2MM ${pane}MM ${tag}`,
        qty: strict ? n : pick<Figure>(NA, NA, n),
        len: pick<Figure>(NA, NA, D - 200),
      },
      {
        desc: `SHEET CLADDING BACK COMMON 1.2MM ${pane}MM ${tag}`,
        qty: strict ? n : pick<Figure>(NA, n, NA),
        len: pick<Figure>(NA, W - 200, NA),
      },
    ]),
  ];

  /* ---------------- doors, brackets, fasteners (rows 81-99) ----------------
     Fasteners follow the owner's per-part counts (handwritten Rules Book,
     2026-10-03), summed over the parts this job actually gets; they replaced
     the flat 52F / 203F. "150 ch" in the note is read as the 135 channel
     family (1.5 mm, 3 mm bracket, top and 2nd-last channels); "6 + 6" on a
     channel as 6 screws per side. Each rivnut pairs with one bolt/screw.
       M8 / piece: 170 channel 6, 135 channel 4, lintel 4; corner posts 4 per
                   corner per landing (16) + 2 per corner at the top (8).
       M5 / piece: sill 5 at ground, 7 above; cover 8; 170 channel 12;
                   135 channel 12; dead weight 4; D-locking post 8; door post
                   cladding 8; lintel 13.
     One door set per landing (owner v1, 2026-10-09; both R and L were listed
     before): its hand comes from the opening, "AT 700 R" -> R, "600L SW" -> L,
     "700 CO" -> C (centre opening). */
  const count = (test: (d: string) => boolean) =>
    channels.reduce((n, c) => {
      const q = nn(c.qty);
      return test(c.desc) && isNum(q) && q > 0 && isNum(nn(c.len)) ? n + q : n;
    }, 0);
  const n170 = count((d) => /170/.test(d) && !/COVER/.test(d));
  const n135 = count((d) => (/135/.test(d) || /TOP CHANNEL/.test(d)) && !/COVER/.test(d));
  const nCover = count((d) => /COVER/.test(d));
  const doorSets = 1; // one hand per landing (v1)
  const m8 = 6 * n170 + 4 * n135 + 4 * doorSets * F + 16 * F + 8;
  const m5 =
    5 + 7 * (F - 1) + // sill
    8 * nCover +
    12 * n170 +
    12 * n135 +
    4 * F + // dead weight channel
    (8 + 8 + 13) * doorSets * F; // D-locking post, door post cladding, lintel

  const hand = doorHand(inp.doorOpening);
  const hardware: HardwareRow[] = [
    { desc: `DOOR POST  D LOCKING ${hand}`, tag: inp.doorOpening, qty: F },
    { desc: `DOOR POST CLADING ${hand}`, tag: inp.doorOpening, qty: F },
    { desc: `LINTEL PANEL  ${hand}`, tag: inp.doorOpening, qty: F },
    { desc: "HEADER BRACKET CHANNEL", qty: F },
    // Added in R1. The 122 plate is a flat 2 whatever the floor count.
    { desc: "BRACKET FIXING PLATE 122", qty: 2 },
    // Two per 135 bracket channel (3F - 1 of them) = 6F - 2.
    { desc: "BRACKET FIXING PLATE 124", qty: F * 3 * 2 - 2 },
    { desc: "JOINT PLATE HEX", qty: F * 12 }, // 8F until the 2026-10-03 update
    { desc: "JOINT PLATE HOLE", qty: F * 8 },
    { desc: "RIVNUT 8", qty: m8 },
    { desc: "RIV NUT 5", qty: m5 },
    { desc: "M8 X 30 BOLT", qty: m8 },
    { desc: "M5 X 20 SCREW", qty: m5 },
    { desc: "DEAD WEIGHT CHANNEL", qty: F * 1 },
    // v1 H23: =IF(... ISNUMBER(SEARCH("CO", C17)) ..., C8, "NO")
    { desc: "DEAD WEIGHT CHANNEL HOLDING BRACKET", qty: hand === "C" ? F : NA },
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
    pitChannels,
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
