/**
 * Generator for src/lib/packing-list/packing-list-sections.ts (v3).
 *
 * The packing list now mirrors the factory's real MECHANICAL PART LIST format
 * (Part List.xlsx, 238 jobs). Each "section" is a PARTICULAR (column C) — the
 * canonical, merged, in-order list of every particular appearing in >=3 jobs.
 * Item particulars search inventory (scoped to a category where we can map one);
 * fastener / kit / consumable particulars are free-text capture lines.
 *
 * Run: node scripts/gen-partlist-template.js
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

const CORPUS = "C:/Users/yash_/Downloads/Part List.xlsx";
const MIN_JOBS = 3;
const SKIP = new Set(["Safety parts", "Sheet1331", "NEW RULES", "Production", "Production 1", "Rules", "Test"]);

function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

const norm = (s) =>
  s.toString().toLowerCase()
    .replace(/[""'']/g, "")
    .replace(/[:\-–]+\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")") // merge "(Main) (R)" == "(Main)(R)"
    .trim();
const isMarker = (c) => /^part\b/i.test(c) || /^page\b/i.test(c) || /^sl\b/i.test(c);

// Free-text = things NOT stocked as inventory items: fasteners, fixing kits,
// and a few raw consumables with no inventory category. Oils / grease / G.I
// wire / cotton tape ARE inventory items, so they stay 'item'.
function classify(label) {
  const l = label.toLowerCase();
  if (/fixing kit/.test(l)) return "free";
  if (/^(bolt|screw|nut|c\.s\.k|ch\.hd|self tap|wooden screw|wooden gutka|split pin|washn|rivet)\b/.test(l)
      || /bolt\+|\+nut|\+s\.w|\+f\.w|\+sw|\+fw|screw\b/.test(l)) return "free";
  if (/^(rabin|cotton wire|wooden chip|nut & flat|nut &flat)/.test(l)) return "free";
  return "item";
}

// Strip part-list qualifiers so we can match a particular to an inventory category.
function cleanForMatch(label) {
  return label.toLowerCase()
    .replace(/\(sr\.no.*$/i, "")
    .replace(/\([^)]*\)/g, " ")          // drop (Main),(CO),(NIDEC)…
    .replace(/\b(co|at|aff|mt|lhs|rhs|home|goods|main|counter|gov|landing|car|new|std|mrl|r1|spl|s\.s|ms|m\.s)\b/gi, " ")
    .replace(/\bfixing kit\b/gi, " ")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ").trim();
}

// Hand overrides: particular (normalized) → category PATH. Highest priority.
const OVERRIDES = {
  "guide rail (main)": "Large Purchased Items > Guide Rail",
  "guide rail (counter)": "Large Purchased Items > Guide Rail",
  "machine unit": "Large Purchased Items > Machine Unit",
  "speed governor": "Small Purchased Items > Speed Governor",
  "mobil": "Small Purchased Items > Oil/Mobil",
  "grease": "Small Purchased Items > Oil/Mobil",
  "synthetic oil": "Small Purchased Items > Oil/Mobil",
  "gear oil": "Small Purchased Items > Oil/Mobil",
  "hydraulic oil": "Small Purchased Items > Oil/Mobil",
  "oil pot set": "Small Purchased Items > Oil/Mobil",
  "oil pot": "Small Purchased Items > Oil/Mobil",
  "g.i wire": "Small Purchased Items > G.I Wire",
  "g.i wire no-24": "Small Purchased Items > G.I Wire",
  "pit switch": "Miscallaneous > Pit Switch Box",
  "cabin rubber pad": "Small Purchased Items > Cabin Rubber Pad",
  "rubber pad": "Small Purchased Items > Cabin Rubber Pad",
  "wire rope (main)": "Large Purchased Items > Wire Rope",
  "wire rope (gov)": "Large Purchased Items > Wire Rope",
  "rope belt": "Large Purchased Items > Belt",
  "thimbel (o-type)": "Hardware > Thimbel",
  "thimbel (belt)": "Hardware > Thimbel",
  "thimbel": "Hardware > Thimbel",
  "bull dog clip (main)": "Hardware > Bull Dog Clips",
  "bull dog clip (gov)": "Hardware > Bull Dog Clips",
  "bull dog clip (belt)": "Hardware > Bull Dog Clips",
  "bull dog clip": "Hardware > Bull Dog Clips",
  "d shackle": 'Hardware > "D" Shackle',
  "pvc cable hanger": "Small Purchased Items > PVC Cable Hanger",
  "retiring cam set": "Small Purchased Items > Retiring Cam Set",
  "fan grill": "Small Purchased Items > Fan Grill",
  "fan grill guard": "Small Purchased Items > Fan Grill",
  "landing header system co": "Header Systems > Landing Header System",
  "landing header system at": "Header Systems > Landing Header System",
  "car header system co": "Header Systems > Car Header System",
  "car header system at": "Header Systems > Car Header System",
  "car header hanging bkt": "Header Systems > Car Header Hanging Bkt",
  "alluminium sill (landing)": "Door Sill > Aluminium Sill",
  "alluminium sill (car)": "Door Sill > Aluminium Sill",
  "alluminium sill": "Door Sill > Aluminium Sill",
  "fireman's switch box (red)": "Small Purchased Items > Fireman's Switch Box",
  "main rail bracket": "Rail Bracket > Rail Bracket Main",
  "rail bracket main": "Rail Bracket > Rail Bracket Main",
  "rail bracket main combination": "Rail Bracket > Rail Bracket Combination Main",
  "rail bracket main (home)": "Rail Bracket > Rail Bracket Combination Home",
  "rail bracket counter": "Rail Bracket > Rail Bracket Counter",
  "rail clip (main)": "Hardware > Rail Clip",
  "rail clip (counter)": "Hardware > Rail Clip",
  "rail clip": "Hardware > Rail Clip",
  "troughing": "Small Manufactured Items > Troughing",
  "controller bracket (new)": "Small Manufactured Items > Controller Bracket",
  "auto door post (co)": "Door Post/Frame > Auto Door Post",
  "auto door post (at)": "Door Post/Frame > Auto Door Post",
  "collapsible door post (goods / lhs)": "Door Post/Frame > Collapsible Door Post",
  "lintone pannal": "Linton Pannel > Auto Door Linton Pannel",
  "lintone panal": "Linton Pannel > Auto Door Linton Pannel",
  "sill angle": "Door Sill > Auto Door Sill Angle",
  "gate lock": "Small Purchased Items > Gate Lock Items",
  "gate lock keeper": "Small Purchased Items > Gate Lock Items",
  "buffer spring": "Hardware > Buffer Spring",
  "counter weight frame": "Counter Weight Frame",
  "counter guide shoe holder": "Miscallaneous > Counter Guide Shoe Holder",
  "guide shoe liner": "Guide Shoe",
  "gathering clip": "Hardware > Gathering Clip",
  "gathering clip (pvc)": "Hardware > Gathering Clip",
  "gathering clip (m.s)": "Hardware > Gathering Clip",
  "safety rod": "Small Manufactured Items > Safety Rod",
  "up right channel": "Safety Frame > UP Right Channel",
  "safety frame std": "Safety Frame > Safety Frame Std",
  "safety frame mrl": "Safety Frame > Safety Frame R1",
  "safety frame mrl/r1": "Safety Frame > Safety Frame R1",
  "safety frame home": "Safety Frame > Safety Frame Home",
  "counter guard net": "Small Manufactured Items > Counter Guard Net",
  "counter guard net bkt std": "Small Manufactured Items > Counter Guard Net",
  "counter guard net bkt goods": "Small Manufactured Items > Counter Guard Net",
  "counter guard net bkt": "Small Manufactured Items > Counter Guard Net",
  "c.i pully": "Pulley Items > CI Pulley",
  "c.i. pully (counter)": "Pulley Items > CI Pulley",
  "c.i. pully (main)": "Pulley Items > CI Pulley",
  "p.v.c pully": "Pulley Items > PVC Pulley",
  "p.v.c pully (counter frame)": "Pulley Items > PVC Pulley",
  "pvc pully (counter)": "Pulley Items > PVC Pulley",
  "pvc pully (main)": "Pulley Items > PVC Pulley",
  "belt pully (counter)": "Pulley Items > Belt Pully",
  "belt pully (main)": "Pulley Items > Belt Pully",
  "counter pully rope guard": "Pulley Items > Counter Pully Rope Guard",
  "main pully rope guard": "Pulley Items > Main Pully Rope Guard",
  "pit ladder": "Miscallaneous > Pit Ladder",
  "stationary cam": ["Small Manufactured Items > Stationary Cam STD", "Small Manufactured Items > Stationary Cam Home", "Small Manufactured Items > Stationary Cam Drumbwater"],
  "stationary cam bkt home": "Small Manufactured Items > Stationary Cam Bkt Home",
  "limit switch": "Miscallaneous > Limit Switch Items",
  "limit switch bkt": "Miscallaneous > Limit Switch Items",
  "limit switch home": "Miscallaneous > Limit Switch Items",
  "limit switch cam": "Miscallaneous > Limit Switch Items",
  "machine beam": "Machine Beam",
  "machine beam bkt (450mm)": "Machine Beam > Machine Beam Bracket",
  "machine rubber pad": "Small Purchased Items > Machine Rubber Pad",
  "islution rubber pad": "Small Purchased Items > Machine Rubber Pad",
  "kick angel": "Miscallaneous > Kick Angel",
  "tension weight": "Small Manufactured Items > Tension Weight",
  "governor switch": "Miscallaneous > Governor Switch",
  "combination leg": "Rail Bracket > Rail Bracket Combination Main",
  "safety switch bkt": "Small Manufactured Items > Safety Switch Bkt",
  "i-bolt": "Hardware > I-Bolt Rod",
  "i-bolt rod": "Hardware > I-Bolt Rod",
  "i-bolt spring": "Hardware > I-Bolt Spring",
  "filler weight (m.s custting / ahm)": "Filler Weight > Filler Weight",
  "filler weight (m.s flat)": "Filler Weight > Filler Weight",
  "filler weight locking bracket": "Filler Weight > Filler Weight Locking Bracket",
  "cotton tape": "Miscallaneous > Cotton Tape",
  "buffer mounting channel main": "Small Manufactured Items > Buffer Channel",
  "buffer mounting channel counter": "Small Manufactured Items > Buffer Channel",
  "buffer stand main (goods)": "Small Manufactured Items > Buffer Stand",
  "buffer stand counter (goods)": "Small Manufactured Items > Buffer Stand",
  "platform": "Cabin > Platform",
  "cabin pannel": "Cabin > Side Panel",
  "canopy (top)": "Cabin > Canopy",
  "floor tiles": "Small Purchased Items > Floor Tiles",
  "chequered plate": "Chequered Plate",
  "skirting": "Miscallaneous > Skirting",
  "slide brassing": "Small Manufactured Items > Slide Brassing",
  "canopy angle": "Small Manufactured Items > Canopy Angle",
  "toe guard": "Small Manufactured Items > Toe Guard",
  "toe guard bracket": "Small Manufactured Items > Toe Guard Bracket",
  "car location": "Miscallaneous > Car Location",
  "car location plate (spl)": "Miscallaneous > Car Location",
  "car gate switch bkt": "Small Manufactured Items > Car Gate Switch Bkt",
  "car gate arm": "Small Manufactured Items > Car Gate Arm",
  "danger plate": "Miscallaneous > Danger Plate",
  "safety tips plate": "Miscallaneous > Safety Tips Plate",
  "cabin glass 10mm": "Glass > Cabin Glass",
  "cabin handrail (s.s)": "Small Purchased Items > S.S Handle",
  "cable hangern bkt": "Small Manufactured Items > Cable Hangern Bkt",
  "returning cam bkt": "Small Manufactured Items > Returning Cam Bkt",
  "stiffner": "Small Manufactured Items > Stiffner",
  "read bracket": "Small Manufactured Items > Read Channel/Switch Items",
  "read channel": "Small Manufactured Items > Read Channel/Switch Items",
  "magnet bracket": "Small Manufactured Items > Magnet Bracket",
  "magnet trey": "Small Manufactured Items > Magnet Trey",
  "pit switch box": "Miscallaneous > Pit Switch Box",
  "facia plate": "Small Manufactured Items > Facia Plate/Bracket",
  "facia bkt": "Small Manufactured Items > Facia Plate/Bracket",
  "landing door pannel at": "Landing Door Pannel",
  "car door pannel at": "Car Door Pannel",
  "telescopic door shoe 12mm": "Small Purchased Items > Telescopic Door Shoe",
  "m.s bush": "Hardware > M.S Bush",
  "pvc magnet holder & magnet 40mm": "Small Purchased Items > Magnet Holder",
  "pvc excution": "Miscallaneous > PVC Excussion",
  "rubber buffer 10mm": "Miscallaneous > Rubber Buffer",
  "rubber buffer": "Miscallaneous > Rubber Buffer",
  "collapsible gate 12+1channel": "Car Door Pannel > Collapsible Door",
  "collapsible top track car": "Small Manufactured Items > Collapsible Top track",
  "collapsible top track landing": "Small Manufactured Items > Collapsible Top track",
  "collapsible landing sill (s.s)": "Door Sill > Collapsible Landing Sill",
  "gate handel": "Miscallaneous > Gate Handel",
  "door catcher": "Miscallaneous > Door Catcher",
  "imperforated gate": "Imperforated Door",
};

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: cats } = await supabase.from("item_categories").select("id, name, parent_id");
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c) => { const p = []; let cur = c, g = 0; while (cur && g++ < 12) { p.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : null; } return p.join(" > "); };
  const validPaths = new Set(cats.map((c) => pathOf(c)));
  // leaf-name → longest path (for fuzzy contains match)
  const leaves = cats.map((c) => ({ name: c.name.toLowerCase(), path: pathOf(c) }));

  // Normalize override keys through the SAME norm() used on extracted labels,
  // so apostrophe/spacing/punctuation differences never cause a miss.
  const OVERRIDES_NORM = {};
  for (const [k, v] of Object.entries(OVERRIDES)) OVERRIDES_NORM[norm(k)] = v;

  // Returns an ARRAY of category paths (a particular may map to several leaves).
  const matchCategory = (normLabel, label) => {
    const ov = OVERRIDES_NORM[normLabel];
    if (ov) return Array.isArray(ov) ? ov : [ov];
    const cleaned = cleanForMatch(label);
    if (!cleaned) return [];
    let best = null;
    for (const lf of leaves) {
      if (lf.name === cleaned) return [lf.path];
      if (cleaned.includes(lf.name) && lf.name.length >= 4) {
        if (!best || lf.name.length > best.len) best = { path: lf.path, len: lf.name.length };
      }
    }
    return best ? [best.path] : [];
  };

  // ---- extract ordered master particulars from the corpus ----
  const wb = XLSX.readFile(CORPUS);
  const agg = new Map();
  for (const name of wb.SheetNames) {
    if (SKIP.has(name)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    let hdr = -1, pc = 2, sc = 3;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = (rows[i] || []).map((x) => x.toString().toLowerCase());
      const j = r.findIndex((x) => x.includes("particular"));
      if (j >= 0) { hdr = i; pc = j; const s = r.findIndex((x) => x.includes("specification")); sc = s >= 0 ? s : pc + 1; break; }
    }
    if (hdr < 0) continue;
    const items = [];
    for (let i = hdr + 1; i < rows.length; i++) {
      const c = (rows[i]?.[pc] || "").toString().trim();
      if (!c || isMarker(c)) continue;
      items.push({ label: c, spec: (rows[i]?.[sc] || "").toString().trim() });
    }
    if (items.length < 10) continue;
    const total = items.length;
    items.forEach((it, idx) => {
      const k = norm(it.label); if (!k) return;
      let e = agg.get(k);
      if (!e) { e = { labels: new Map(), specs: new Map(), sheets: new Set(), posSum: 0, posN: 0 }; agg.set(k, e); }
      e.labels.set(it.label, (e.labels.get(it.label) || 0) + 1);
      if (it.spec) e.specs.set(it.spec, (e.specs.get(it.spec) || 0) + 1);
      e.sheets.add(name); e.posSum += idx / total; e.posN++;
    });
  }

  const all = [...agg.entries()].map(([k, e]) => ({
    norm: k,
    label: [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
    freq: e.sheets.size,
    avgPos: e.posSum / e.posN,
    specHint: ([...e.specs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]) || "",
  }));
  const list = all.filter((x) => x.freq >= MIN_JOBS).sort((a, b) => a.avgPos - b.avgPos);

  const slug = (s) => "p-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55);
  const seenSlug = new Set();
  let mappedItem = 0, freeCount = 0, unscopedItem = 0;
  const sections = list.map((x) => {
    const type = classify(x.label);
    let key = slug(x.norm); let n = 2; while (seenSlug.has(key)) key = slug(x.norm) + "-" + n++; seenSlug.add(key);
    let categoryPaths = [];
    if (type === "item") {
      categoryPaths = matchCategory(x.norm, x.label).filter((p) => validPaths.has(p));
      if (categoryPaths.length) mappedItem++; else unscopedItem++;
    } else freeCount++;
    return { key, label: x.label, captureType: type, categoryPaths, specHint: x.specHint, freq: x.freq };
  });

  console.log(`particulars (>= ${MIN_JOBS} jobs): ${sections.length}`);
  console.log(`  item w/ category scope: ${mappedItem}`);
  console.log(`  item unscoped (global search): ${unscopedItem}`);
  console.log(`  free-text (fastener/kit/consumable): ${freeCount}`);

  // ---- emit ----
  const emit = sections.map((s) =>
    `  {\n    key: ${JSON.stringify(s.key)},\n    label: ${JSON.stringify(s.label)},\n    captureType: ${JSON.stringify(s.captureType)},\n    categoryPaths: ${JSON.stringify(s.categoryPaths)},\n    specHint: ${JSON.stringify(s.specHint)},\n  },`
  ).join("\n");

  const ts = `/**
 * Packing-list template — the factory's MECHANICAL PART LIST format.
 *
 * GENERATED by scripts/gen-partlist-template.js from Part List.xlsx (238 jobs).
 * One entry per PARTICULAR (the part list's Column C = category), merged across
 * all jobs and kept in canonical assembly order. Do not hand-edit; edit the
 * generator's OVERRIDES and re-run (it also emits scripts/_packing_sections.json
 * for the bulk-seed script).
 *
 *   - key:          stable slug of the particular (packing_list_lines.section_key).
 *   - label:        the Particular text shown to the packer (Column C).
 *   - captureType:  'item'  = inventory search (scoped to categoryPaths if any);
 *                   'free'  = free-text line (fasteners / fixing kits / consumables
 *                             that aren't stocked as inventory items).
 *   - categoryPaths: ERP category PATH(s) scoping an item search ([] = all inventory).
 *   - specHint:     a common Specification example, used as the input placeholder.
 */

export type CaptureType = "item" | "free";

export interface PackingSection {
  key: string;
  label: string;
  captureType: CaptureType;
  categoryPaths: string[];
  specHint: string;
}

export const PACKING_SECTIONS: PackingSection[] = [
${emit}
];

const SECTION_BY_KEY = new Map(PACKING_SECTIONS.map((s) => [s.key, s]));
export function packingSection(key: string): PackingSection | undefined {
  return SECTION_BY_KEY.get(key);
}
`;
  const outDir = path.join(__dirname, "..", "src", "lib", "packing-list");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "packing-list-sections.ts"), ts);
  fs.writeFileSync(path.join(__dirname, "_packing_sections.json"),
    JSON.stringify(sections.map((s) => ({ key: s.key, label: s.label, captureType: s.captureType, categoryPaths: s.categoryPaths, specHint: s.specHint })), null, 0));
  console.log(`\nWrote packing-list-sections.ts (${sections.length}) + _packing_sections.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
