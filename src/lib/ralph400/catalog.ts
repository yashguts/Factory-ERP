/* ------------------------------------------------------------------
   RALPH 400 — structure item codes and names (scheme v2, 2026-10-03)

   Rule: the CODE says what the part IS (profile, thickness, hand). Where it
   goes (face, level) and its cut size are NOT in the code — they make up the
   piece mark printed on the part list:

       R4-C135-15 · B-1ST · 1400        code · face-level · size

   Two pieces share a code only if they can be swapped on the shop floor.
   Confirmed by the owner 2026-10-03: top channel and overhead ring channel
   are their own profiles; corner extensions are mirrored per corner (like
   the 2450 posts); the 3 mm bracket version is its own part.

   Code    R4-<PART>[-<thickness: 15 = 1.5 mm, 30 = 3 mm, 12 = 1.2 mm, 6 = 6 mm>][B]
           B = bracket version (counterweight face). Corner parts end in the
           corner (FL, FR, BL, BR); door parts in the hand (R, L, or C for a
           centre-opening door).
   Name    <noun> <size> · <variant> · <thickness>, noun first so an A-Z sort
           keeps channels, covers, posts and plates together.

   Mirrored by the Catalog sheet of the RALPH 400 workbook
   (scripts/ralph400/build_workbook.py).
   ------------------------------------------------------------------ */

export interface CatalogItem {
  code: string;
  name: string;
  family: string;
}

const CORNERS = [
  ["FL", "front-left"],
  ["FR", "front-right"],
  ["BL", "back-left"],
  ["BR", "back-right"],
] as const;

export const CATALOG: CatalogItem[] = [
  ...CORNERS.map(([c, n]) => ({ code: `R4-PST-${c}`, name: `Post 2450 · ${n} · 3 mm`, family: "Posts" })),
  ...CORNERS.map(([c, n]) => ({ code: `R4-PSX-${c}`, name: `Post extension · ${n} · 3 mm`, family: "Posts" })),
  { code: "R4-C170-15", name: "Channel 170 · 1.5 mm", family: "Channels" },
  { code: "R4-C170-30B", name: "Channel 170 · bracket · 3 mm", family: "Channels" },
  { code: "R4-C135-15", name: "Channel 135 · 1.5 mm", family: "Channels" },
  { code: "R4-C135-30B", name: "Channel 135 · bracket · 3 mm", family: "Channels" },
  { code: "R4-C142", name: "Channel 142 · sill", family: "Channels" },
  { code: "R4-CTP-30", name: "Channel top · 3 mm", family: "Channels" },
  { code: "R4-CTP-30B", name: "Channel top · bracket · 3 mm", family: "Channels" },
  { code: "R4-CRG-15", name: "Channel overhead ring · 1.5 mm", family: "Channels" },
  { code: "R4-CRG-30B", name: "Channel overhead ring · bracket · 3 mm", family: "Channels" },
  { code: "R4-CHD", name: "Channel header bracket", family: "Channels" },
  { code: "R4-CDW", name: "Channel dead weight", family: "Channels" },
  { code: "R4-CPT", name: "Channel pit", family: "Channels" },
  { code: "R4-BDW", name: "Bracket · dead weight channel holding", family: "Plates" },
  { code: "R4-V170-12", name: "Cover 170 · 1.2 mm", family: "Covers" },
  { code: "R4-V135-12", name: "Cover 135 · 1.2 mm", family: "Covers" },
  { code: "R4-VRG-12", name: "Cover overhead ring · 1.2 mm", family: "Covers" },
  { code: "R4-GL-6", name: "Glass · 6 mm", family: "Panels" },
  { code: "R4-SH-12", name: "Sheet cladding · 1.2 mm", family: "Panels" },
  { code: "R4-DLP-R", name: "Door post D-locking · RH", family: "Door" },
  { code: "R4-DLP-L", name: "Door post D-locking · LH", family: "Door" },
  { code: "R4-DLP-C", name: "Door post D-locking · CO", family: "Door" },
  { code: "R4-DPC-R", name: "Door post cladding · RH", family: "Door" },
  { code: "R4-DPC-L", name: "Door post cladding · LH", family: "Door" },
  { code: "R4-DPC-C", name: "Door post cladding · CO", family: "Door" },
  { code: "R4-LNT-R", name: "Door lintel panel · RH", family: "Door" },
  { code: "R4-LNT-L", name: "Door lintel panel · LH", family: "Door" },
  { code: "R4-LNT-C", name: "Door lintel panel · CO", family: "Door" },
  { code: "R4-P122", name: "Plate 122 · bracket fixing", family: "Plates" },
  { code: "R4-P124", name: "Plate 124 · bracket fixing", family: "Plates" },
  { code: "R4-PJX", name: "Plate joint · hex", family: "Plates" },
  { code: "R4-PJH", name: "Plate joint · hole", family: "Plates" },
  { code: "R4-B830", name: "Bolt M8 × 30", family: "Fasteners" },
  { code: "R4-S520", name: "Screw M5 × 20", family: "Fasteners" },
  { code: "R4-RN8", name: "Rivnut M8", family: "Fasteners" },
  { code: "R4-RN5", name: "Rivnut M5", family: "Fasteners" },
];

const BY_CODE = new Map(CATALOG.map((c) => [c.code, c]));

/** Corner suffix from a workbook corner-post description ("FRONT LEFT ..."). */
export function cornerOf(desc: string): "FL" | "FR" | "BL" | "BR" {
  const d = desc.toUpperCase();
  return /FRONT\s+LEFT/.test(d) ? "FL" : /FRONT\s+RIGHT/.test(d) ? "FR" : /BACK\s+LEFT/.test(d) ? "BL" : "BR";
}

/**
 * Code for one model row. `desc` is the workbook row description the model
 * carries; `bracket` = cut as the counterweight-face bracket version.
 */
export function codeFor(desc: string, opts: { section: string; bracket?: boolean } = { section: "" }): string | null {
  const d = desc.toUpperCase().replace(/\s+/g, " ");
  const br = !!opts.bracket;
  if (/PIT CHANNEL/.test(d)) return "R4-CPT";
  if (opts.section === "verticals") return `R4-PSX-${cornerOf(d)}`;
  if (opts.section === "glass" || /^GLASS/.test(d)) return "R4-GL-6";
  if (opts.section === "cladding" || /^SHEET CLADDING/.test(d)) return "R4-SH-12";
  if (/VERTICAL \(2450/.test(d)) return `R4-PST-${cornerOf(d)}`;
  if (/SILL/.test(d)) return "R4-C142";
  if (/2ND LAST/.test(d)) return /COVER/.test(d) ? "R4-VRG-12" : br ? "R4-CRG-30B" : "R4-CRG-15";
  if (/COVER/.test(d)) return /170/.test(d) ? "R4-V170-12" : "R4-V135-12";
  if (/TOP CHANNEL/.test(d)) return br ? "R4-CTP-30B" : "R4-CTP-30";
  if (/BRACKET CHANNEL 135/.test(d)) return "R4-C135-30B";
  if (/170/.test(d)) return br ? "R4-C170-30B" : "R4-C170-15";
  if (/135/.test(d)) return "R4-C135-15";
  const hand = (d.match(/\b([RLC])$/) ?? [])[1] ?? "L";
  if (/D LOCKING/.test(d)) return `R4-DLP-${hand}`;
  if (/DOOR POST CLADING/.test(d)) return `R4-DPC-${hand}`;
  if (/LINTEL/.test(d)) return `R4-LNT-${hand}`;
  if (/HEADER BRACKET/.test(d)) return "R4-CHD";
  if (/DEAD WEIGHT CHANNEL HOLDING/.test(d)) return "R4-BDW";
  if (/DEAD WEIGHT/.test(d)) return "R4-CDW";
  if (/PLATE 122/.test(d)) return "R4-P122";
  if (/PLATE 124/.test(d)) return "R4-P124";
  if (/JOINT PLATE HEX/.test(d)) return "R4-PJX";
  if (/JOINT PLATE HOLE/.test(d)) return "R4-PJH";
  if (/RIV ?NUT ?8/.test(d)) return "R4-RN8";
  if (/RIV ?NUT ?5/.test(d)) return "R4-RN5";
  if (/M8 X 30/.test(d)) return "R4-B830";
  if (/M5 X 20/.test(d)) return "R4-S520";
  return null;
}

export function catalogItem(code: string | null): CatalogItem | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

const FACE_LETTER: Record<string, string> = { LEFT: "L", RIGHT: "R", BACK: "B", FRONT: "F" };

/** Piece mark: code · face-level · size (any part may be missing). */
export function pieceMark(code: string, face?: string, level?: string, size?: string): string {
  const lv = level === "OVERHEAD" ? "OH" : level;
  const pos = [face ? FACE_LETTER[face] ?? face : "", lv ?? ""].filter(Boolean).join("-");
  return [code, pos, size ?? ""].filter(Boolean).join(" · ");
}
