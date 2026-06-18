/**
 * Generator for src/lib/packing-list/packing-list-sections.ts
 *
 * Reads the factory's finished-stock register (a_copy.xlsx) to recover the
 * canonical packing-list SECTION ORDER (column A group headers) and the
 * base item-names within each (column B), then binds each section to one or
 * more ERP category PATHS so the packing-list picker can scope its fuzzy
 * search the way bom-sections.ts does.
 *
 * Run:  node scripts/gen-packing-sections.js
 * It validates every category path against the live category tree and prints
 * any base-name / path that didn't map so the OVERRIDES can be tightened.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ---- env ----
function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

// ---- base-name → category PATHS (Finished Stock sheet) ----
// Authoritative overrides. Anything not here is auto-matched to a category
// leaf whose name equals the (cleaned) base-name. `null` = intentionally
// skip this base-name (consumable / not an inventory category).
const NAME_OVERRIDES = {
  "machine unit": ["Large Purchased Items > Machine Unit"],
  "machine unit belt": ["Large Purchased Items > Machine Unit", "Large Purchased Items > Belt"],
  "belt detector": null,
  "hydraulic oil": ["Small Purchased Items > Oil/Mobil"],
  "synthetic oil": ["Small Purchased Items > Oil/Mobil"],
  "gear oil": ["Small Purchased Items > Oil/Mobil"],
  "mobil": ["Small Purchased Items > Oil/Mobil"],
  "grease": ["Small Purchased Items > Oil/Mobil"],
  "oil pot set": ["Small Purchased Items > Oil/Mobil"],
  "oil pot": ["Small Purchased Items > Oil/Mobil"],
  "wire rope": ["Large Purchased Items > Wire Rope"],
  "rope belt": ["Large Purchased Items > Belt"],
  "belt": ["Large Purchased Items > Belt"],
  "thimbel": ["Hardware > Thimbel"],
  "bull dog clip": ["Hardware > Bull Dog Clips"],
  '"d" shackle': ['Hardware > "D" Shackle'],
  "pvc cable hanger": ["Small Purchased Items > PVC Cable Hanger"],
  "retiring cam set": ["Small Purchased Items > Retiring Cam Set"],
  "square fan grill": ["Small Purchased Items > Fan Grill"],
  "blower fan grill": ["Small Purchased Items > Fan Grill"],
  "alluminium sill": ["Door Sill > Aluminium Sill"],
  "landing header system": ["Header Systems > Landing Header System"],
  "car header system": ["Header Systems > Car Header System"],
  "door shoe channel": ["Header Systems > DOOR SHOE CHANNEL"],
  "dead weight25x25": ["Header Systems > Dead Weight25x25"],
  "header": ["Header Systems > HEADER"],
  "landing header system (prolift)": ["Header Systems > Landing Header System"],
  "landing header system(prolift)": ["Header Systems > Landing Header System"],
  "car header system (prolift)": ["Header Systems > Car Header System"],
  "car header system (framater)": ["Header Systems > Car Header System (Framater)"],
  "car header hanging bkt": ["Header Systems > Car Header Hanging Bkt"],
  "fireman's switch box": ["Small Purchased Items > Fireman's Switch Box"],
  "stud anchor": ["Hardware > Stud Anchor"],
  "brick dasfastner": ["Hardware > Brick Dasfastner"],
  "rag bolt": ["Hardware > Rag Bolt"],
  "rail bracket main combination": ["Rail Bracket > Rail Bracket Combination Main"],
  "rail bracket combination": ["Rail Bracket > Rail Bracket Combination Main", "Rail Bracket > Rail Bracket Combination Home"],
  "rail clip combination": ["Rail Bracket > Rail Clip Combination"],
  "rail bracket main": ["Rail Bracket > Rail Bracket Main"],
  "rail bracket counter (home)": ["Rail Bracket > Rail Bracket Counter Home"],
  "rail bracket counter": ["Rail Bracket > Rail Bracket Counter"],
  "machine beam tray": ["Rail Bracket > Machine Beam Tray"],
  "counter goods": ["Rail Bracket > Rail Bracket Counter"],
  "combination leg": ["Rail Bracket > Rail Bracket Combination Main"],
  "fabrication bracket": ["Rail Bracket"],
  "rail clip": ["Hardware > Rail Clip"],
  "troughing": ["Small Manufactured Items > Troughing"],
  "troughing cover": ["Small Manufactured Items > Troughing"],
  "wooden chip": null,
  "nut": null,
  "nut+f.w": null,
  "pvc troughing": ["Small Manufactured Items > Troughing"],
  "pvc troughing cover": ["Small Manufactured Items > Troughing"],
  "g.i wire": ["Small Purchased Items > G.I Wire"],
  "controller bracket": ["Small Manufactured Items > Controller Bracket"],
  "collapsible door post": ["Door Post/Frame > Collapsible Door Post"],
  "collapsible top bottom set": ["Door Post/Frame > Collapsible Top Bottom set"],
  "collapsible landing sill": ["Door Sill > Collapsible Landing Sill"],
  "collapsible top track": ["Small Manufactured Items > Collapsible Top track"],
  "collapsible goods": ["Door Post/Frame > Collapsible Door Post"],
  "swing door frame": ["Door Post/Frame > Swing Door Post"],
  "swing door post": ["Door Post/Frame > Swing Door Post"],
  "swing door top": ["Swing Door > Swing Door Top"],
  "swing door sill angel": ["Small Manufactured Items > Swing Door Sill Angle"],
  "swing door cover": ["Swing Door > Swing Door Cover"],
  "swing door": ["Swing Door > Swing Door"],
  "gate lock": ["Small Purchased Items > Gate Lock Items"],
  "gate lock keeper": ["Small Purchased Items > Gate Lock Items"],
  "sill bracket": ["Small Manufactured Items > Sill Bracket"],
  "lop box": ["Miscallaneous > Lop Box"],
  "manual telescopic door post": ["Door Post/Frame > Manual Telescopic Door Post"],
  "manual telescopic linton pannel": ["Linton Pannel > Manual Telescopic Linton Pannel"],
  "manual telescopic landing header system": ["Header Systems > Manual Telescopic Landing Header System"],
  "manual telescopic car header system": ["Header Systems > Manual Telescopic Car Header System"],
  "manual telescopic sill": ["Door Sill > Manual Telescopic Sill"],
  "manual telescopic sill angle": ["Small Manufactured Items > Manual Telescopic Sill Angle"],
  "sill & header adjustable bracket": ["Adjustable Bracket > Sill & Header Adjustable Bracket"],
  "sill & header adjustable bracket-": ["Adjustable Bracket > Sill & Header Adjustable Bracket"],
  "supporting bracket": ["Miscallaneous > Supporting Bracket"],
  "auto door post": ["Door Post/Frame > Auto Door Post"],
  "dead weight channel": ["Small Manufactured Items > Dead Weight Channel"],
  "auto door linton pannel": ["Linton Pannel > Auto Door Linton Pannel", "Linton Pannel > ACO Linton Pannel"],
  "auto door sill angle": ["Door Sill > Auto Door Sill Angle"],
  "auto door ss sill": ["Door Sill > Auto Door SS Sill"],
  "buffer spring": ["Hardware > Buffer Spring"],
  "oil buffer spring": ["Hardware > Buffer Spring"],
  "guide shoe": ["Guide Shoe"],
  "counter guide shoe holder std": ["Miscallaneous > Counter Guide Shoe Holder"],
  "counter guide shoe holder goods": ["Miscallaneous > Counter Guide Shoe Holder"],
  "guide shoe liner": ["Guide Shoe"],
  "gathering clip": ["Hardware > Gathering Clip"],
  "safety rod": ["Small Manufactured Items > Safety Rod"],
  "up right channel": ["Safety Frame > UP Right Channel"],
  "up right channel r1": ["Safety Frame > UP Right Channel"],
  "hitch plate": ["Miscallaneous > Hitch Plate"],
  "counter guard net": ["Small Manufactured Items > Counter Guard Net"],
  "counter guard g.i home": ["Small Manufactured Items > Counter Guard Net"],
  "counter guard net bkt std": ["Small Manufactured Items > Counter Guard Net"],
  "counter guard net bkt goods": ["Small Manufactured Items > Counter Guard Net"],
  "pit ladder": ["Miscallaneous > Pit Ladder"],
  "stationary cam std": ["Small Manufactured Items > Stationary Cam STD"],
  "stationary cam home": ["Small Manufactured Items > Stationary Cam Home"],
  "stationary cam bkt home": ["Small Manufactured Items > Stationary Cam Bkt Home"],
  "stationary cam drumbwater": ["Small Manufactured Items > Stationary Cam Drumbwater"],
  "limit switch cam": ["Miscallaneous > Limit Switch Items"],
  "limit switch bkt": ["Miscallaneous > Limit Switch Items"],
  "limit switch": ["Miscallaneous > Limit Switch Items"],
  "limit switch home": ["Miscallaneous > Limit Switch Items"],
  "final limit switch": ["Miscallaneous > Limit Switch Items"],
  "governor switch": ["Miscallaneous > Governor Switch"],
  "machine rubber pad": ["Small Purchased Items > Machine Rubber Pad"],
  "cabin rubber pad": ["Small Purchased Items > Cabin Rubber Pad"],
  "safety liver pvc bush": ["Small Purchased Items > Safety Liver PVC Bush"],
  "isolation channel": ["Small Manufactured Items > Isolation Channel"],
  "car location plate": ["Miscallaneous > Car Location"],
  "kick angel": ["Miscallaneous > Kick Angel"],
  "keeper angel": ["Miscallaneous > Keeper Angel"],
  "tension weight": ["Small Manufactured Items > Tension Weight"],
  "safety switch bkt": ["Small Manufactured Items > Safety Switch Bkt"],
  "i-bolt rod": ["Hardware > I-Bolt Rod"],
  "belt i-bolt rod": ["Hardware > Belt I-Bolt Rod"],
  "i-bolt spring": ["Hardware > I-Bolt Spring"],
  "filler weight": ["Filler Weight > Filler Weight"],
  "filler weight a.h.m": ["Filler Weight > Filler Weight"],
  "filler weight locking bracket": ["Filler Weight > Filler Weight Locking Bracket"],
  "cotton tape": ["Miscallaneous > Cotton Tape"],
  "buffer mounting channel main std": ["Small Manufactured Items > Buffer Channel"],
  "buffer mounting channel counter std": ["Small Manufactured Items > Buffer Channel"],
  "buffer mounting channel main": ["Small Manufactured Items > Buffer Channel"],
  "buffer stand main": ["Small Manufactured Items > Buffer Stand"],
  "buffer stand counter": ["Small Manufactured Items > Buffer Stand"],
  "floor tiles": ["Small Purchased Items > Floor Tiles"],
  "flooring rubber pvc": ["Small Purchased Items > Floor Tiles"],
  "skirting": ["Miscallaneous > Skirting"],
  "slide brassing": ["Small Manufactured Items > Slide Brassing"],
  "canopy angle": ["Small Manufactured Items > Canopy Angle"],
  "toe guard": ["Small Manufactured Items > Toe Guard"],
  "toe guard bracket": ["Small Manufactured Items > Toe Guard Bracket"],
  "car location": ["Miscallaneous > Car Location"],
  "car gate switch bkt": ["Small Manufactured Items > Car Gate Switch Bkt"],
  "car gate arm": ["Small Manufactured Items > Car Gate Arm"],
  "danger plate": ["Miscallaneous > Danger Plate"],
  "safety tips plate": ["Miscallaneous > Safety Tips Plate"],
  "s.s handle": ["Small Purchased Items > S.S Handle"],
  "cable hangern bkt": ["Small Manufactured Items > Cable Hangern Bkt"],
  "returning cam bkt": ["Small Manufactured Items > Returning Cam Bkt"],
  "stiffner": ["Small Manufactured Items > Stiffner"],
  "read channel": ["Small Manufactured Items > Read Channel/Switch Items"],
  "read switch bkt": ["Small Manufactured Items > Read Channel/Switch Items"],
  "magnet bracket": ["Small Manufactured Items > Magnet Bracket"],
  "magnet trey": ["Small Manufactured Items > Magnet Trey"],
  "pit switch box": ["Miscallaneous > Pit Switch Box"],
  "facia plate": ["Small Manufactured Items > Facia Plate/Bracket"],
  "facia bkt": ["Small Manufactured Items > Facia Plate/Bracket"],
  "bearing": ["Hardware > Bearing"],
  "cerclip": ["Hardware > Cerclip"],
  "guide shoe linner": ["Guide Shoe"],
  "safety counter spring": ["Small Purchased Items > Safety Counter Spring"],
  "gate handel": ["Miscallaneous > Gate Handel"],
  "door catcher": ["Miscallaneous > Door Catcher"],
  "pvc excussion": ["Miscallaneous > PVC Excussion"],
  "rubber buffer": ["Miscallaneous > Rubber Buffer"],
  "m.s bush": ["Hardware > M.S Bush"],
  "telescopic door shoe": ["Small Purchased Items > Telescopic Door Shoe"],
  "magnet holder": ["Small Purchased Items > Magnet Holder"],
  "hydrolic cam": ["Miscallaneous > Hydraulic Cam"],
  "machine beam bkt": ["Machine Beam > Machine Beam Bracket"],
  "tension spring": ["Small Purchased Items > Tension Spring"],
  "speed governor": ["Small Purchased Items > Speed Governor"],
  "door closer": ["Small Purchased Items > Door Closer"],
  "machine beam": ["Machine Beam"],
  "machine beam r1": ["Machine Beam > Machine Beam R1"],
  "machine beam plate r1": ["Machine Beam > Machine Beam Plate R1"],
  "machine beam pully arragement r1": ["Machine Beam > Machine Beam Pully Arragement R1"],
  "machine beam hitch plate r1": ["Machine Beam > Machine Beam Hitch Plate R1"],
  "counter weight frame goods": ["Counter Weight Frame > Counter Weight Frame Goods"],
  "counter weight frame mrl": ["Counter Weight Frame > Counter Weight Frame MRL"],
  "counter weight frame std": ["Counter Weight Frame > Counter Weight Frame STD"],
  "counter weight frame home": ["Counter Weight Frame > Counter Weight Frame Home"],
  "counter weight frame std(side channel)": ["Counter Weight Frame > Counter Weight Frame STD(Side Channel)"],
  "safety guide shoe": ["Safety Frame > Safety Guide Shoe Items"],
  "safety guide shoe roller": ["Safety Frame > Safety Guide Shoe Items"],
  "bottom pully u clamp": ["Safety Frame"],
  "safety frame std": ["Safety Frame > Safety Frame Std"],
  "safety frame r1": ["Safety Frame > Safety Frame R1"],
  "safety frame": ["Safety Frame > Safety Frame"],
  "safety bottom pully": ["Safety Frame"],
  "safety frame goods": ["Safety Frame > Safety Frame Goods"],
  "safety frame home": ["Safety Frame > Safety Frame Home"],
  "safety frame cantiliver": ["Safety Frame > Safety Frame Cantiliver"],
  "safety frame home belt": ["Safety Frame > Safety Frame Home Belt"],
  "hydraulic cylinder gmv": ["Hydraulic Items > Hydraulic Cylinder GMV"],
  "power pack gmv": ["Hydraulic Items > Power Pack GMV"],
  "aluminium pipes": ["Small Purchased Items > Aluminium Pipes"],
};

// Extra category paths appended to a Finished-Stock section by its column-A
// LABEL (for items that belong under the section's heading but have no matching
// column-B base-name, e.g. CI/Belt pulleys under "Governor & tenssion pully").
const FS_LABEL_EXTRAS = {
  "Governor & tenssion pully": ["Pulley Items"],
};

// Door-panel sections are keyed by their column-A LABEL (base-names are just
// "Landing Pannel" / "Car Pannel"). Matched by label prefix, longest first.
const DOOR_LABEL_RULES = [
  ["MT Door Pannel Landing", ["Landing Door Pannel > Manual Telescopic"]],
  ["MT Door Pannel Car", ["Car Door Pannel > Manual Telescopic"]],
  ["Auto Four Fold Door Pannel Landing", ["Landing Door Pannel > Auto Four Fold"]],
  ["Auto Four Fold Door Pannel Car", ["Car Door Pannel > Auto Four Fold", "Landing Door Pannel > Auto Four Fold", "Car Door Pannel > Collapsible Door", "Imperforated Door", "By Parting Door"]],
  ["Auto Door Pannel Car (Short Height)", ["Car Door Pannel"]],
  ["Auto Door Pannel (Short Height)", ["Landing Door Pannel"]],
  ["Auto Door Landing Pannel", ["Landing Door Pannel"]],
  ["Auto Door Car Pannel", ["Car Door Pannel"]],
];

function cleanBaseName(b) {
  return b
    .toLowerCase()
    .replace(/\+nut.*$/i, "")
    .replace(/\+f\.w.*$/i, "")
    .replace(/\+s\.w.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { data: cats, error } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  if (error) throw error;

  // Build path index.
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c) => {
    const parts = [];
    let cur = c, guard = 0;
    while (cur && guard++ < 12) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return parts.join(" > ");
  };
  const validPaths = new Set(cats.map((c) => pathOf(c)));
  const leafByName = new Map(); // lower(name) -> [paths]
  for (const c of cats) {
    const k = c.name.toLowerCase();
    const arr = leafByName.get(k) ?? [];
    arr.push(pathOf(c));
    leafByName.set(k, arr);
  }

  const autoMatch = (cleaned) => {
    const exact = leafByName.get(cleaned);
    if (exact) return exact.slice(0, 1);
    return null;
  };

  // ---- read Excel sections ----
  const wb = XLSX.readFile(path.join(__dirname, "..", "a_copy.xlsx"));
  const sheets = [
    { name: "Finished Stock", prefix: "fs" },
    { name: "Door Pannel", prefix: "dp" },
  ];

  const sections = [];
  const unmapped = new Set();
  for (const sh of sheets) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh.name], {
      header: 1, raw: false, defval: "",
    });
    let cur = null, idx = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const A = (r[0] || "").toString().trim();
      const B = (r[1] || "").toString().trim();
      const C = (r[2] || "").toString().trim();
      const D = (r[3] || "").toString().trim();
      const isHeader = A && !D && !C;
      if (isHeader) {
        idx++;
        cur = {
          key: `${sh.prefix}-${String(idx).padStart(3, "0")}`,
          sheet: sh.name,
          label: A,
          baseNames: new Set(),
          rowCount: 0,
        };
        sections.push(cur);
      } else if ((B || C || D) && cur) {
        if (B) cur.baseNames.add(B);
        cur.rowCount++;
      }
    }
  }

  // ---- bind category paths ----
  for (const sec of sections) {
    const paths = [];
    const push = (p) => { if (p && !paths.includes(p)) paths.push(p); };

    if (sec.sheet === "Door Pannel") {
      const rule = DOOR_LABEL_RULES.find(([pre]) =>
        sec.label.toLowerCase().startsWith(pre.toLowerCase()),
      );
      if (rule) rule[1].forEach(push);
      else unmapped.add(`DOORLABEL: ${sec.label}`);
    } else {
      for (const bn of sec.baseNames) {
        const cleaned = cleanBaseName(bn);
        if (cleaned in NAME_OVERRIDES) {
          const ov = NAME_OVERRIDES[cleaned];
          if (ov) ov.forEach(push);
          continue;
        }
        const am = autoMatch(cleaned);
        if (am) am.forEach(push);
        else unmapped.add(`${sec.label} :: "${bn}"`);
      }
      if (FS_LABEL_EXTRAS[sec.label]) FS_LABEL_EXTRAS[sec.label].forEach(push);
    }

    // validate
    sec.categoryPaths = paths.filter((p) => {
      if (validPaths.has(p)) return true;
      unmapped.add(`INVALID PATH: ${p} (in ${sec.label})`);
      return false;
    });
    sec.baseNames = [...sec.baseNames];
  }

  // ---- report ----
  console.log(`Sections: ${sections.length}`);
  const noCat = sections.filter((s) => s.categoryPaths.length === 0);
  console.log(`Sections with NO category binding: ${noCat.length}`);
  noCat.forEach((s) => console.log("   • " + s.key + " " + s.label + "  base=" + JSON.stringify(s.baseNames)));
  console.log(`\nUnmapped base-names / issues: ${unmapped.size}`);
  [...unmapped].sort().forEach((u) => console.log("   - " + u));

  // ---- emit TS ----
  const emit = sections.map((s) => {
    return `  {\n    key: ${JSON.stringify(s.key)},\n    sheet: ${JSON.stringify(s.sheet)},\n    label: ${JSON.stringify(s.label)},\n    baseNames: ${JSON.stringify(s.baseNames)},\n    categoryPaths: ${JSON.stringify(s.categoryPaths)},\n  },`;
  }).join("\n");

  const ts = `/**
 * Packing-list section skeleton — the factory's canonical finished-stock
 * register order (from a_copy.xlsx: "Finished Stock" then "Door Pannel").
 *
 * GENERATED by scripts/gen-packing-sections.js — do not hand-edit the array
 * below; edit the generator's overrides and re-run. Each section:
 *   - key:           stable id (sheet prefix + ordinal) — referenced by
 *                    packing_list_lines.section_key, so it must stay stable.
 *   - sheet:         which register page the section came from.
 *   - label:         column-A header shown to the packer (factory wording,
 *                    typos preserved).
 *   - baseNames:     column-B item base-names in that section (search hint).
 *   - categoryPaths: ERP category PATH strings for scoping the item search,
 *                    same convention as bom-sections.ts (resolved + expanded
 *                    to descendants by lib/actions/categories.ts). Empty = the
 *                    picker searches all categories.
 */

export interface PackingSection {
  key: string;
  sheet: string;
  label: string;
  baseNames: string[];
  categoryPaths: string[];
}

export const PACKING_SECTIONS: PackingSection[] = [
${emit}
];

/** Distinct register pages, in order — used to group the checklist UI. */
export const PACKING_SHEETS: string[] = Array.from(
  PACKING_SECTIONS.reduce((set, s) => set.add(s.sheet), new Set<string>()),
);

const SECTION_BY_KEY = new Map(PACKING_SECTIONS.map((s) => [s.key, s]));
export function packingSection(key: string): PackingSection | undefined {
  return SECTION_BY_KEY.get(key);
}
`;

  const outDir = path.join(__dirname, "..", "src", "lib", "packing-list");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "packing-list-sections.ts"), ts);
  // Also emit a plain JSON copy so the bulk-seed script (plain node) shares the
  // exact same section order + category bindings as the app.
  fs.writeFileSync(
    path.join(__dirname, "_packing_sections.json"),
    JSON.stringify(sections.map((s) => ({
      key: s.key, sheet: s.sheet, label: s.label,
      baseNames: s.baseNames, categoryPaths: s.categoryPaths,
    })), null, 0),
  );
  console.log(`\nWrote src/lib/packing-list/packing-list-sections.ts (${sections.length} sections)`);
  console.log(`Wrote scripts/_packing_sections.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
