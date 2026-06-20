/**
 * Layer 0 — Rules + vocabulary + door/drive skeletons.
 *
 * From the engineer's own sheets:
 *   - `Rules`     : capacity-band -> guide/counter SIZE matrix (Guide Rail, Fish
 *                   Plate are the band-mapped ones) + option lists per part.
 *   - `NEW RULES` : controlled vocabulary of valid spec values per part.
 *   - template sheets (AUTO DOOR(V3F) / TELESCOPIC(V3F) / COLLAPSIBLE / HOME /
 *                   AUTO DOOR GOODS / ...) : the part-list SKELETON per door/drive
 *                   (which section_keys appear).
 *
 * Run: node scripts/partlist-brain/extract-rules.js
 * Out: data/rules.json, data/vocab.json, data/templates.json
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const CORPUS = "C:/Users/yash_/Downloads/Part List.xlsx";
const DATA = path.join(__dirname, "data");

const norm = (s) =>
  s.toString().toLowerCase().replace(/[“”‘’]/g, "").replace(/[:\-–]+\s*$/, "")
    .replace(/\s+/g, " ").replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").trim();

// section template + the canon() so skeletons speak section keys
const sections = require(path.join(__dirname, "..", "_packing_sections.json"));
const byNorm = new Map(sections.map((s) => [norm(s.label), s]));
const baseIndex = new Map();
for (const s of sections) { const n = norm(s.label); if (!n.includes("(")) baseIndex.set(n, s); }
const stripParens = (s) => norm(s).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
const keyFor = (label) => { const h = byNorm.get(norm(label)) || baseIndex.get(stripParens(label)); return h ? h.key : null; };

function rows(sheet, wb) { return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: "" }); }

// --- bands: classify a job spec into a Rules column ---
const BANDS = [
  { key: "4-10P", label: "4 - 10 P" },
  { key: "13-16P", label: "13 - 16 P (~1 ton)" },
  { key: ">1Ton", label: "> 1 Ton (>16 P)" },
  { key: "4Ton", label: "4 Ton" },
  { key: "GoodsMR<1.5", label: "Goods MR (<1.5 ton)" },
  { key: "GoodsMR2-2.5", label: "Goods MR (2-2.5 ton)" },
  { key: "GoodsMR3", label: "Goods MR (3 ton)" },
];
// map a Rules header string -> our band key
function headerToBand(h) {
  const s = h.toLowerCase();
  if (/4\s*-\s*10/.test(s)) return "4-10P";
  if (/13\s*-\s*16/.test(s)) return "13-16P";
  if (/>\s*1\s*ton/.test(s) && !/goods/.test(s)) return ">1Ton";
  if (/^4\s*ton/.test(s) || (/4\s*ton/.test(s) && !/goods/.test(s))) return "4Ton";
  if (/goods/.test(s) && /<\s*1\.5/.test(s)) return "GoodsMR<1.5";
  if (/goods/.test(s) && /(2-2\.5|2\.5)/.test(s)) return "GoodsMR2-2.5";
  if (/goods/.test(s) && /3\s*ton/.test(s)) return "GoodsMR3";
  return null;
}

function main() {
  const wb = XLSX.readFile(CORPUS);

  // ---------- Rules: band-mapped sizing (guide rail, fish plate) + option lists
  const R = rows("Rules", wb);
  const header = R[0].map((x) => String(x).trim());
  const bandCol = {}; // band key -> col index
  header.forEach((h, i) => { const b = headerToBand(h); if (b) bandCol[b] = i; });

  const sizing = {};   // partNorm -> { bandKey: { guide, counter } }
  const optionLists = {}; // partNorm -> [sizes]
  // A value that looks like a size/spec (vs a part-name header).
  const isSizeLike = (c) => /^\s*\d/.test(c) || /\b(mm|hp|pass|pully|mts|grm|rpm|ton|kg|nos)\b/i.test(c) || /\dx\d|x\s*\d/i.test(c) || /\d{2,}/.test(c);
  let curPart = null;
  for (let i = 1; i < R.length; i++) {
    const r = R[i].map((x) => String(x).trim());
    const c0 = r[0];
    if (!c0 && r.slice(1).every((x) => !x)) { curPart = null; continue; } // blank divider
    if (c0 && !isSizeLike(c0)) { curPart = norm(c0.split("/")[0]); optionLists[curPart] = []; continue; } // header row -> new part
    if (!curPart || !c0) continue;
    // size row under curPart
    optionLists[curPart].push(c0);
    for (const [band, ci] of Object.entries(bandCol)) {
      const cell = (r[ci] || "").toLowerCase();
      if (!cell) continue;
      sizing[curPart] = sizing[curPart] || {};
      sizing[curPart][band] = sizing[curPart][band] || {};
      if (cell.includes("guide")) sizing[curPart][band].guide = c0;
      if (cell.includes("counter")) sizing[curPart][band].counter = c0;
    }
  }

  fs.writeFileSync(path.join(DATA, "rules.json"), JSON.stringify({ bands: BANDS, sizing, optionLists }));

  // ---------- NEW RULES vocabulary
  const NR = rows("NEW RULES", wb);
  const vocab = {}; let vk = null;
  for (const r of NR) {
    const c0 = String(r[0] || "").trim();
    if (!c0) { vk = null; continue; }
    const looksSize = /^[\d./x]/i.test(c0) || /mm$|hp|pass|grm|mts|no\.?\d/i.test(c0);
    if (!looksSize) { vk = norm(c0); vocab[vk] = vocab[vk] || []; }
    else if (vk) vocab[vk].push(c0);
  }
  fs.writeFileSync(path.join(DATA, "vocab.json"), JSON.stringify(vocab));

  // ---------- door/drive skeletons
  const TEMPLATE_SHEETS = {
    "AUTO DOOR(V3F)": { door: "ACO", drive: "V3F" },
    "AUTO DOOR MRLR1": { door: "ACO", drive: "MRL" },
    "TELESCOPIC(V3F)": { door: "AT", drive: "V3F" },
    "AUTO DOOR GOODS": { door: "ACO", drive: "V3F", goods: true },
    "COLLAPSIBEL(V3F)": { door: "COLLAPSIBLE", drive: "V3F" },
    "COLLAPSIBLE": { door: "COLLAPSIBLE", drive: null },
    "HOME": { door: "AUTO", drive: "HOME", home: true },
  };
  const templates = {};
  for (const [sheet, meta] of Object.entries(TEMPLATE_SHEETS)) {
    if (!wb.Sheets[sheet]) continue;
    const R2 = rows(sheet, wb);
    let hdr = -1, pc = 2;
    for (let i = 0; i < Math.min(R2.length, 15); i++) { const rr = R2[i].map((x) => String(x).toLowerCase()); const j = rr.findIndex((x) => x.includes("particular")); if (j >= 0) { hdr = i; pc = j; break; } }
    if (hdr < 0) continue;
    const keys = new Set();
    for (let i = hdr + 1; i < R2.length; i++) {
      const p = String(R2[i][pc] || "").trim();
      if (!p || /^part\b|^page\b|^sl\b/i.test(p)) continue;
      const k = keyFor(p); if (k) keys.add(k);
    }
    templates[sheet] = { ...meta, sectionKeys: [...keys] };
  }
  fs.writeFileSync(path.join(DATA, "templates.json"), JSON.stringify(templates));

  // summary
  console.log("RULES sizing (band-mapped parts):");
  for (const [p, m] of Object.entries(sizing)) {
    console.log(`  ${p}`);
    for (const [b, v] of Object.entries(m)) console.log(`      ${b.padEnd(13)} guide=${v.guide || "-"}  counter=${v.counter || "-"}`);
  }
  console.log(`\noption lists: ${Object.keys(optionLists).length} parts`);
  console.log(`NEW RULES vocab: ${Object.keys(vocab).length} parts`);
  console.log(`door/drive skeletons:`);
  for (const [s, t] of Object.entries(templates)) console.log(`  ${s.padEnd(18)} door=${t.door} drive=${t.drive || "-"}  -> ${t.sectionKeys.length} sections`);
}
main();
