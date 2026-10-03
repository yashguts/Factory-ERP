/* ------------------------------------------------------------------
   RALPH 400 — structure item codes and names

   One code per part TYPE. The cut size, face and level are separate
   columns on the part list, so a code never encodes a job-specific length.

     R4-<FAMILY>-<VARIANT>[-<HAND>]

     PST  corner posts (3 mm)        GLS  glass 6 mm
     CLD  sheet cladding 1.2 mm      CHN  horizontal channels
     CVR  channel covers 1.2 mm      DOR  door frame parts
     PLT  plates                     FST  fasteners

   A "B" at the end of a channel variant = the 3 mm bracket version used on
   the counterweight face. HAND is R / L for the door-frame sets, or the
   corner (FL, FR, BL, BR) for the 2450 corner posts.

   Names read: <part> <spec> (<material/thickness>). Face and level are never
   part of the name. Mirrored by the Catalog sheet of the RALPH 400 workbook.
   ------------------------------------------------------------------ */

export interface CatalogItem {
  code: string;
  name: string;
  family: string;
}

export const CATALOG: CatalogItem[] = [
  { code: "R4-PST-2450-FL", name: "Corner post 2450, front-left (3 mm)", family: "PST" },
  { code: "R4-PST-2450-FR", name: "Corner post 2450, front-right (3 mm)", family: "PST" },
  { code: "R4-PST-2450-BL", name: "Corner post 2450, back-left (3 mm)", family: "PST" },
  { code: "R4-PST-2450-BR", name: "Corner post 2450, back-right (3 mm)", family: "PST" },
  { code: "R4-PST-EXT", name: "Corner post extension, cut to length (3 mm)", family: "PST" },
  { code: "R4-GLS-EXT", name: "Glass, extension panel (6 mm)", family: "GLS" },
  { code: "R4-GLS-1128", name: "Glass, module panel 1128 (6 mm)", family: "GLS" },
  { code: "R4-GLS-1098", name: "Glass, lowest module panel 1098 (6 mm)", family: "GLS" },
  { code: "R4-CLD-EXT", name: "Cladding sheet, extension panel (1.2 mm)", family: "CLD" },
  { code: "R4-CLD-OH", name: "Cladding sheet, overhead panel (1.2 mm)", family: "CLD" },
  { code: "R4-CLD-1090", name: "Cladding sheet, module panel 1090 (1.2 mm)", family: "CLD" },
  { code: "R4-CLD-1062", name: "Cladding sheet, lowest module panel 1062 (1.2 mm)", family: "CLD" },
  { code: "R4-CHN-170", name: "Base channel 170 (1.5 mm)", family: "CHN" },
  { code: "R4-CHN-170B", name: "Base channel 170, bracket version (3 mm)", family: "CHN" },
  { code: "R4-CHN-142", name: "Sill channel 142", family: "CHN" },
  { code: "R4-CHN-135", name: "Channel 135 (1.5 mm)", family: "CHN" },
  { code: "R4-CHN-135B", name: "Bracket channel 135 (3 mm)", family: "CHN" },
  { code: "R4-CHN-TOP", name: "Top channel (3 mm)", family: "CHN" },
  { code: "R4-CHN-TOPB", name: "Top channel, bracket version (3 mm)", family: "CHN" },
  { code: "R4-CHN-RNG", name: "Overhead ring channel 135", family: "CHN" },
  { code: "R4-CHN-RNGB", name: "Overhead ring channel 135, bracket version", family: "CHN" },
  { code: "R4-CHN-HDR", name: "Header bracket channel", family: "CHN" },
  { code: "R4-CHN-DWT", name: "Dead weight channel", family: "CHN" },
  { code: "R4-CVR-170", name: "Cover for base channel 170 (1.2 mm)", family: "CVR" },
  { code: "R4-CVR-135", name: "Cover for channel 135 (1.2 mm)", family: "CVR" },
  { code: "R4-CVR-RNG", name: "Cover for overhead ring channel 135 (1.2 mm)", family: "CVR" },
  { code: "R4-DOR-DLP-R", name: "Door post, D-locking, RH", family: "DOR" },
  { code: "R4-DOR-DLP-L", name: "Door post, D-locking, LH", family: "DOR" },
  { code: "R4-DOR-CLD-R", name: "Door post cladding, RH", family: "DOR" },
  { code: "R4-DOR-CLD-L", name: "Door post cladding, LH", family: "DOR" },
  { code: "R4-DOR-LNT-R", name: "Lintel panel, RH", family: "DOR" },
  { code: "R4-DOR-LNT-L", name: "Lintel panel, LH", family: "DOR" },
  { code: "R4-PLT-122", name: "Bracket fixing plate 122", family: "PLT" },
  { code: "R4-PLT-124", name: "Bracket fixing plate 124", family: "PLT" },
  { code: "R4-PLT-JHX", name: "Joint plate, hex", family: "PLT" },
  { code: "R4-PLT-JHL", name: "Joint plate, hole", family: "PLT" },
  { code: "R4-FST-RN8", name: "Rivnut M8", family: "FST" },
  { code: "R4-FST-RN5", name: "Rivnut M5", family: "FST" },
  { code: "R4-FST-B830", name: "Bolt M8 × 30", family: "FST" },
  { code: "R4-FST-S520", name: "Screw M5 × 20", family: "FST" },
];

const BY_CODE = new Map(CATALOG.map((c) => [c.code, c]));

/**
 * Code for one model row. `desc` is the workbook row description the model
 * carries; `bracket` = cut as the counterweight-face bracket version.
 */
export function codeFor(desc: string, opts: { section: string; bracket?: boolean } = { section: "" }): string | null {
  const d = desc.toUpperCase().replace(/\s+/g, " ");
  const br = !!opts.bracket;
  if (opts.section === "verticals") return "R4-PST-EXT";
  if (opts.section === "glass") return "R4-GLS-EXT";
  if (opts.section === "cladding") return "R4-CLD-EXT"; // overhead row is re-coded by the caller
  if (/VERTICAL \(2450/.test(d)) {
    const corner = /FRONT LEFT/.test(d) ? "FL" : /FRONT RIGHT/.test(d) ? "FR" : /BACK LEFT/.test(d) ? "BL" : "BR";
    return `R4-PST-2450-${corner}`;
  }
  if (/^GLASS/.test(d)) return /1098/.test(d) ? "R4-GLS-1098" : "R4-GLS-1128";
  if (/^SHEET CLADDING/.test(d)) return /1062/.test(d) ? "R4-CLD-1062" : "R4-CLD-1090";
  if (/SILL/.test(d)) return "R4-CHN-142";
  if (/2ND LAST/.test(d)) return /COVER/.test(d) ? "R4-CVR-RNG" : br ? "R4-CHN-RNGB" : "R4-CHN-RNG";
  if (/COVER/.test(d)) return /170/.test(d) ? "R4-CVR-170" : "R4-CVR-135";
  if (/TOP CHANNEL/.test(d)) return br ? "R4-CHN-TOPB" : "R4-CHN-TOP";
  if (/BRACKET CHANNEL 135/.test(d)) return "R4-CHN-135B";
  if (/170/.test(d)) return br ? "R4-CHN-170B" : "R4-CHN-170";
  if (/135/.test(d)) return "R4-CHN-135";
  if (/D LOCKING/.test(d)) return /\bR$/.test(d) ? "R4-DOR-DLP-R" : "R4-DOR-DLP-L";
  if (/DOOR POST CLADING/.test(d)) return /\bR$/.test(d) ? "R4-DOR-CLD-R" : "R4-DOR-CLD-L";
  if (/LINTEL/.test(d)) return /\bR$/.test(d) ? "R4-DOR-LNT-R" : "R4-DOR-LNT-L";
  if (/HEADER BRACKET/.test(d)) return "R4-CHN-HDR";
  if (/DEAD WEIGHT/.test(d)) return "R4-CHN-DWT";
  if (/PLATE 122/.test(d)) return "R4-PLT-122";
  if (/PLATE 124/.test(d)) return "R4-PLT-124";
  if (/JOINT PLATE HEX/.test(d)) return "R4-PLT-JHX";
  if (/JOINT PLATE HOLE/.test(d)) return "R4-PLT-JHL";
  if (/RIV ?NUT ?8/.test(d)) return "R4-FST-RN8";
  if (/RIV ?NUT ?5/.test(d)) return "R4-FST-RN5";
  if (/M8 X 30/.test(d)) return "R4-FST-B830";
  if (/M5 X 20/.test(d)) return "R4-FST-S520";
  return null;
}

export function catalogItem(code: string | null): CatalogItem | undefined {
  return code ? BY_CODE.get(code) : undefined;
}
