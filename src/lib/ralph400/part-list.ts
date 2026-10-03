/* ------------------------------------------------------------------
   RALPH 400 — part list

   Turns the Sheet2 model (model.ts) into what the factory actually needs: a
   list of parts for ONE job, one line per part per level/face, only the parts
   the job uses, with a size and a quantity. The arithmetic stays in model.ts
   (clean mode = the owner's current rules); this file only reshapes it, checks
   the inputs, and adds item codes + piece marks (catalog.ts).
   ------------------------------------------------------------------ */

import {
  compute,
  FLOOR_FIELDS,
  MIN_OVERHEAD,
  MODULE_H,
  NA,
  OPTIONS,
  minHeight,
  type Figure,
  type FloorKey,
  type PanelCell,
  type Ralph400Inputs,
  type Ralph400Result,
} from "./model";
import { catalogItem, codeFor, pieceMark } from "./catalog";

export const MAX_STOPS = 6; // H1..H5 = five rises
export const LEVEL_LABELS = ["PIT", "GND", "1ST", "2ND", "3RD", "4TH", "OVERHEAD"] as const;

export type SectionKey = "verticals" | "console" | "glass" | "cladding" | "channels" | "overhead" | "hardware";

export const SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: "verticals", title: "Corner verticals", blurb: "Extension pieces between the 2450 modules, one per corner per level" },
  { key: "console", title: "2450 console modules", blurb: "One fixed module per landing: corner verticals, sill, standard panes" },
  { key: "glass", title: "Glass panels 6 mm", blurb: "Extension glass on every side face except the counterweight face" },
  { key: "cladding", title: "Sheet cladding 1.2 mm", blurb: "Counterweight face (and front when CWT is BACK); overhead on all four faces" },
  { key: "channels", title: "Horizontal channels & covers", blurb: "Channels span a face; covers are channel length + 9 (170) or + 38 (135)" },
  { key: "overhead", title: "Overhead ring", blurb: "2nd-last channels closing the overhead" },
  { key: "hardware", title: "Doors, plates & fasteners", blurb: "Counted per floor" },
];

export interface PartLine {
  key: string;
  section: SectionKey;
  part: string;
  /** Structure item code (lib/ralph400/catalog.ts), e.g. R4-C135-15. */
  code?: string;
  /** Piece mark: code · face-level · size, e.g. "R4-C135-15 · B · 1400". */
  mark?: string;
  drawing?: string;
  level?: string;
  face?: string;
  /** Printable size: a length ("1100") or a panel ("1000 × 1385"); "" for hardware. */
  size: string;
  qty: number;
  note?: string;
  /** Cut as the 3 mm bracket version (counterweight face). */
  bracket?: boolean;
  /** Present in the sheet but not supplied for this job (qty/length "NO"). */
  notNeeded?: boolean;
}

export interface InputIssue {
  level: "error" | "warn";
  field?: keyof Ralph400Inputs;
  msg: string;
}

export interface PartListResult {
  lines: PartLine[];
  issues: InputIssue[];
  /** True when an error means the list cannot be trusted (it is still built where possible). */
  blocked: boolean;
  pieces: number;
  glassFaces: string[];
  claddingFaces: string[];
  travel: number;
  model: Ralph400Result;
}

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
const faceOf = (desc: string) => (/\bLEFT\b/.test(desc) ? "LEFT" : /\bRIGHT\b/.test(desc) ? "RIGHT" : /\bBACK\b/.test(desc) ? "BACK" : /\bFRONT\b/.test(desc) ? "FRONT" : undefined);

/** Only the first F − 1 floor heights belong to the job; the rest are ignored. */
export function sanitize(inp: Ralph400Inputs): Ralph400Inputs {
  const F = Math.max(1, Math.min(MAX_STOPS, Math.round(inp.floors || 1)));
  const keep = (i: number, v: number) => (i < F - 1 && isNum(v) && v > 0 ? v : 0);
  return {
    ...inp,
    floors: F,
    h1: keep(0, inp.h1),
    h2: keep(1, inp.h2),
    h3: keep(2, inp.h3),
    h4: keep(3, inp.h4),
    h5: keep(4, inp.h5),
  };
}

export function checkInputs(inp: Ralph400Inputs, opts: { driveType?: string | null } = {}): InputIssue[] {
  const out: InputIssue[] = [];
  const F = Math.round(inp.floors || 0);
  if (!(inp.shaftWidth > 200)) out.push({ level: "error", field: "shaftWidth", msg: "Width external is missing." });
  if (!(inp.shaftDepth > 200)) out.push({ level: "error", field: "shaftDepth", msg: "Depth external is missing." });
  if (!(inp.overHead > 0)) out.push({ level: "error", field: "overHead", msg: "Over head is missing." });
  else if (inp.overHead <= MIN_OVERHEAD)
    out.push({ level: "error", field: "overHead", msg: `Over head ${inp.overHead} mm leaves no room for the overhead cladding (needs more than ${MIN_OVERHEAD} mm).` });
  if (!(inp.pitHeight >= 0)) out.push({ level: "error", field: "pitHeight", msg: "Pit height is missing." });
  // A blank pit reads as 0, which quietly adds 170 mm to the bottom floor's minimum.
  else if (inp.pitHeight === 0)
    out.push({ level: "warn", field: "pitHeight", msg: "Pit height is 0 — check it (a pit under 170 mm raises the bottom-floor minimum)." });
  if (F < 2 || F > MAX_STOPS)
    out.push({ level: "error", field: "floors", msg: `Number of stops must be 2 to ${MAX_STOPS} (the sheet has five floor heights).` });
  if (!OPTIONS.cwt.includes(inp.cwt as (typeof OPTIONS.cwt)[number])) {
    const hyd = (opts.driveType ?? "").toUpperCase() === "HYD";
    out.push({
      level: "error",
      field: "cwt",
      msg: hyd
        ? "Counterweight side is not set. This is a hydraulic lift with no counterweight, but the sheet has no NONE option — pick the rail side (see Rules Book, live-job gap 2)."
        : "Counterweight side is not set.",
    });
  }
  FLOOR_FIELDS.forEach(([key, label], i) => {
    const v = inp[key];
    if (i < F - 1) {
      if (!(isNum(v) && v > 0)) {
        out.push({ level: "error", field: key, msg: `${label} height is missing — a ${F}-stop job needs ${F - 1} floor heights.` });
        return;
      }
      const lim = minHeight(key as FloorKey, inp);
      if (v < lim)
        out.push({
          level: "error",
          field: key,
          msg: `${label} ${v} mm is below the ${lim} mm minimum (2450 module + 142 cladding deduction${key === "h1" ? ", adjusted for the pit" : ""}); its panels would be negative.`,
        });
    } else if (isNum(v) && v > 0) {
      out.push({ level: "warn", field: key, msg: `${label} is filled (${v} mm) but the job has only ${F} stops — ignored.` });
    }
  });
  const op = (inp.doorOpening ?? "").trim();
  if (op && !OPTIONS.doorOpening.includes(op as (typeof OPTIONS.doorOpening)[number]))
    out.push({ level: "warn", field: "doorOpening", msg: `Door opening "${op}" is not one of the sheet's options.` });
  if (!op) out.push({ level: "warn", field: "doorOpening", msg: "Door opening is not set (it only labels the D-locking door post)." });
  const dt = (inp.doorType ?? "").toUpperCase();
  if (op && dt) {
    const kind = /CO/.test(op) ? "ACO" : /SW/.test(op) ? "SWING" : /^AT/.test(op) ? "AT" : "";
    if (kind && kind !== dt)
      out.push({ level: "warn", field: "doorType", msg: `Door type ${dt} does not match the opening "${op}" (${kind}).` });
  }
  return out;
}

const panelSize = (c: PanelCell): string | null =>
  c && !("na" in c) && isNum(c.h) && isNum(c.w) ? `${fmt(c.h)} × ${fmt(c.w)}` : null;
const figSize = (v: Figure | "GLASS"): string | null => (isNum(v) ? fmt(v) : null);
const figQty = (v: Figure): number | null => (isNum(v) ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : null);

/** Flatten one model result into part lines (needed + not-needed). */
function linesFrom(m: Ralph400Result, inp: Ralph400Inputs): PartLine[] {
  const out: PartLine[] = [];
  const F = inp.floors;

  // Corner verticals: one line per corner per level. The four corners are
  // mirrored parts (own codes), though they share a length at each level.
  m.verticals.forEach((row) => {
    const corner = clean(row.desc).replace(/ VERTICAL EXTN$/, "");
    row.cells.forEach((c, i) => {
      const size = figSize(c);
      const level = LEVEL_LABELS[i];
      if (i >= 1 && i <= 5 && !m.activeLevels[i]) return; // level not in this job
      out.push({
        key: `verticals|${corner}|${level}`,
        section: "verticals",
        part: clean(row.desc),
        level,
        size: size ?? "",
        qty: 1,
        notNeeded: !size,
      });
    });
  });

  // 2450 console module rows.
  m.console2450.forEach((r) => {
    const qty = figQty(r.qty);
    // Sheet mode: the workbook's left-sheet row reads "GLASS" on glass faces.
    const w = r.len === "GLASS" ? "GLASS" : figSize(r.len);
    const pane = r.desc.match(/(\d{4})\s*(MM|X)/);
    const isPanel = /GLASS|CLADDING/.test(r.desc);
    const size = isPanel ? (w === "GLASS" ? "GLASS" : w && pane ? `${pane[1]} × ${w}` : "") : w ?? "";
    out.push({
      key: `console|${clean(r.desc)}`,
      section: "console",
      part: clean(r.desc),
      drawing: r.dwg,
      face: isPanel ? faceOf(r.desc) : undefined,
      // Module panels carry level MOD so their piece mark reads e.g. "L-MOD".
      level: isPanel ? "MOD" : undefined,
      size,
      qty: qty ?? 0,
      notNeeded: !(qty && size),
    });
  });

  // Extension glass + cladding panels, per face per level (and overhead cladding).
  m.panels.forEach((r) => {
    const isGlass = r.desc.startsWith("GLASS");
    const face = faceOf(r.desc);
    r.cells.forEach((c, i) => {
      if (c === null) return; // no panel cell at this level (pit, glass overhead)
      const level = LEVEL_LABELS[i];
      if (i >= 1 && i <= 5 && !m.activeLevels[i]) return;
      const size = panelSize(c);
      out.push({
        key: `${isGlass ? "glass" : "cladding"}|${face}|${level}`,
        section: isGlass ? "glass" : "cladding",
        part: isGlass ? "Glass 6 mm" : "Sheet cladding 1.2 mm",
        face,
        level,
        size: size ?? "",
        qty: size ? 1 : 0,
        notNeeded: !size,
      });
    });
  });

  // Horizontal channels (rows 25-42) and the overhead ring (rows 44-50).
  m.channels.forEach((r) => {
    const qty = figQty(r.qty);
    const len = figSize(r.len);
    const needed = !!(qty && len);
    const overhead = /2ND LAST/.test(r.desc);
    const replaced = !needed && r.br && /135 (LEFT|RIGHT|BACK) \(1\.5MM\)/.test(r.desc);
    out.push({
      key: `channels|${clean(r.desc)}`,
      section: overhead ? "overhead" : "channels",
      part: clean(r.desc),
      face: r.tag ? r.tag : faceOf(r.desc),
      size: len ?? "",
      qty: qty ?? 0,
      bracket: needed && !!r.br,
      notNeeded: !needed,
      note: replaced
        ? "Replaced by the 3 mm bracket channel on the counterweight face"
        : needed && r.br
          ? r.tag
            ? `Bracket channel on the ${r.tag} (counterweight) face`
            : "Cut as the bracket version (counterweight face)"
          : /SILL/.test(r.desc)
            ? "One per landing (part of the 2450 module)"
            : undefined,
    });
  });

  // Doors, plates, fasteners.
  m.hardware.forEach((r) => {
    const qty = figQty(r.qty);
    out.push({
      key: `hardware|${clean(r.desc)}`,
      section: "hardware",
      part: clean(r.desc),
      size: "",
      qty: qty ?? 0,
      notNeeded: !qty,
      note: r.tag
        ? `Door opening ${r.tag}`
        : /PLATE 122/.test(r.desc)
          ? "Fixed 2 per job"
          : /RIV|BOLT|SCREW/.test(r.desc)
            ? "Counted from the parts on this list"
            : undefined,
    });
  });

  void F;
  return out;
}

export function buildPartList(raw: Ralph400Inputs, opts: { driveType?: string | null } = {}): PartListResult {
  const issues = checkInputs(raw, opts);
  const inp = sanitize(raw);
  const model = compute(inp, "clean");
  // Floor-wise within the sections that run per level (owner, 2026-10-03):
  // PIT, GND ... 4TH, OVERHEAD; inside a floor the corner/face order stays.
  // Array.sort is stable, so sections without levels keep their order.
  const FLOOR_SECTIONS: SectionKey[] = ["verticals", "glass", "cladding"];
  const floorIdx = (l: PartLine) =>
    FLOOR_SECTIONS.includes(l.section) ? LEVEL_LABELS.indexOf(l.level as (typeof LEVEL_LABELS)[number]) : 0;
  const secIdx = (l: PartLine) => SECTIONS.findIndex((s) => s.key === l.section);
  const lines = linesFrom(model, inp).sort((a, b) => secIdx(a) - secIdx(b) || floorIdx(a) - floorIdx(b));

  // Item code + catalog name. The workbook-style description stays in `key`.
  for (const l of lines) {
    const item = catalogItem(codeFor(l.part, { section: l.section, bracket: l.bracket }));
    if (item) {
      l.code = item.code;
      l.part = item.name;
      l.mark = pieceMark(item.code, l.face, l.level, l.size);
    }
  }

  const needed = lines.filter((l) => !l.notNeeded);
  const faces = (sec: SectionKey) =>
    [...new Set(needed.filter((l) => l.section === sec && l.face).map((l) => l.face as string))];
  const travel = [inp.h1, inp.h2, inp.h3, inp.h4, inp.h5].filter((h) => h > 0).reduce((a, b) => a + b, 0);
  return {
    lines,
    issues,
    blocked: issues.some((i) => i.level === "error"),
    pieces: needed.reduce((a, l) => a + l.qty, 0),
    glassFaces: faces("glass"),
    claddingFaces: faces("cladding"),
    travel,
    model,
  };
}

export { MODULE_H, NA };
