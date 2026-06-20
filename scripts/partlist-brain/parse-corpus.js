/**
 * Layer 0 — Corpus parser.
 *
 * Reads the factory's Part List.xlsx (the real Mechanical Part Lists, one sheet
 * per job) and turns each job sheet into a structured record:
 *
 *   { sheet, jobCode, specRaw, spec:{ stops, capPass, capKg, doorType, driveType,
 *     home, goods, v3f, tokens[] }, lines:[ { particular, norm, sectionKey,
 *     captureType, spec, qty, partGroup, sl } ] }
 *
 * Particulars are mapped to the SAME section_key the packing-list template uses
 * (scripts/_packing_sections.json), via the exact norm() from gen-partlist-template.js,
 * so the brain speaks the same vocabulary as the rest of the ERP.
 *
 * Run: node scripts/partlist-brain/parse-corpus.js
 * Out: scripts/partlist-brain/data/corpus.json
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const CORPUS = "C:/Users/yash_/Downloads/Part List.xlsx";
const OUT = path.join(__dirname, "data", "corpus.json");

// Sheets that are NOT a job (templates, rule sheets, scratch).
const NONJOB = new Set([
  "Safety parts", "Sheet1331", " Part List", "NEW RULES", "Production",
  "Production 1", "Rules", "Test", "AUTO DOOR(V3F)", "AUTO DOOR MRLR1",
  "TELESCOPIC(V3F)", "HOME", "ECO SPASE", "AUTO DOOR GOODS", "COLLAPSIBEL(V3F)",
  "COLLAPSIBLE", "Copy of  Part List", "4295 ELE",
]);

// EXACT norm() from gen-partlist-template.js so we match the same section keys.
const norm = (s) =>
  s.toString().toLowerCase()
    .replace(/[“”‘’]/g, "")
    .replace(/[:\-–]+\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")")
    .trim();

// A "PART X :-" group divider, or a page marker.
const isPartGroup = (c) => /^part\s+[a-z]/i.test(String(c).trim());
const isMarker = (c) => /^part\b/i.test(c) || /^page\b/i.test(c) || /^sl\b/i.test(c);

// Sum additive qty strings: "14+14" -> 28, "48+60" -> 108, "10" -> 10.
function parseQty(v) {
  const s = String(v == null ? "" : v).replace(/[, ]/g, "");
  if (!s) return null;
  const nums = s.match(/-?\d+(\.\d+)?/g);
  if (!nums) return null;
  // Only treat "+"-joined as additive; otherwise take first number.
  if (/\+/.test(s)) return nums.reduce((a, b) => a + parseFloat(b), 0);
  return parseFloat(nums[0]);
}

// --- spec-row parser -------------------------------------------------------
const DOOR_WORDS = ["ACO", "AT", "AFF", "MT", "CO", "AUTO", "TELESCOPIC", "TELESCOPE",
  "COLLAPSIBLE", "COLLAPSIBEL", "SWING", "SWS", "BIPART", "BYPART", "IMPERFORATED",
  "MANUAL", "DUMB", "DUMBWAITER", "GOODS"];
const DRIVE_WORDS = ["MRL", "MR", "V3F", "MV3F", "BELT", "HYD", "HYDRAULIC", "ROPE",
  "CANTI", "CANTILEVER", "GEARLESS", "GEARED", "DRUM"];

function parseSpec(raw) {
  const s = String(raw || "").toUpperCase();
  const out = { stops: null, capPass: null, capKg: null, doorType: null,
    driveType: null, home: false, goods: false, v3f: false, tokens: [] };
  // stops: G+N (+R = roof/machine room, not a stop); B+G+N = N+2
  let m = s.match(/B\s*\+\s*G\s*\+\s*(\d+)/);
  if (m) out.stops = parseInt(m[1], 10) + 2;
  else { m = s.match(/G\s*\+\s*(\d+)/); if (m) out.stops = parseInt(m[1], 10) + 1; }
  // capacity
  m = s.match(/(\d+)\s*PASS/); if (m) out.capPass = parseInt(m[1], 10);
  m = s.match(/(\d+)\s*KG/); if (m) out.capKg = parseInt(m[1], 10);
  // tokens between slashes
  out.tokens = s.split(/[\/|]/).map((t) => t.trim()).filter(Boolean);
  for (const t of out.tokens) {
    for (const d of DOOR_WORDS) if (new RegExp(`\\b${d}\\b`).test(t) && !out.doorType) out.doorType = d;
    for (const d of DRIVE_WORDS) if (new RegExp(`\\b${d}\\b`).test(t) && !out.driveType) out.driveType = d;
  }
  out.home = /\bHOME\b/.test(s);
  out.goods = /\bGOODS\b/.test(s);
  out.v3f = /\bV3F\b/.test(s);
  return out;
}

// --- particular -> section_key map (from the live template) ----------------
const sections = require(path.join(__dirname, "..", "_packing_sections.json"));
const byNorm = new Map();
for (const sec of sections) byNorm.set(norm(sec.label), sec);

// Model/supplier qualifiers inside parentheses — these identify a vendor/model,
// NOT a position. We strip them to a CANONICAL part identity so all
// "Machine Unit (SEG-35)" / "(Sharp / SEG-50)" / "(NIDEC)" collapse to one
// logical part for quantity + sizing. Positional parens (Main)/(Counter)/(Gov)/
// (Belt)/(Landing)/(Car)/(R) are KEPT.
const MODEL_RE = /\b(sharp|seg-?\d*|nidec|bbl|traction|sr\.?\s*no|both|v3f|mrl|r1|model|drum|gearless|geared)\b/i;
// Door-type variant tokens. The SAME physical part is logged with a door suffix
// ("Landing Header System AT" vs "...CO"). Door type is already known from the
// job spec, so we strip it from the canonical identity and re-attach the target's
// door type at predict time. Big win: stops AT/CO from being treated as different
// parts (the main false-positive/false-negative source in backtest v1).
const DOOR_VARIANT_TEST = /\b(aco|aff|at|mt|co)\b/i;
const DOOR_VARIANT_RE = /\b(aco|aff|at|mt|co)\b/gi;
function canon(particular) {
  let n = norm(particular);
  n = n.replace(/\(([^)]*)\)/g, (m, inner) => (MODEL_RE.test(inner) ? "" : m)); // drop model qualifiers
  n = n.replace(/\(([^)]*)\)/g, (m, inner) => (DOOR_VARIANT_TEST.test(inner) ? "" : m)); // drop door qualifier in parens
  n = n.replace(DOOR_VARIANT_RE, " "); // drop bare door tokens
  return n.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
}

// Canonical "base" sections = a section whose label has NO parenthetical.
// Used only as a fallback for particulars that carry a model qualifier the
// template never enumerated (e.g. "Machine Unit (Sharp / SEG-10)").
const baseIndex = new Map();
for (const sec of sections) {
  const n = norm(sec.label);
  if (!n.includes("(")) baseIndex.set(n, sec);
}
const stripAllParens = (s) => norm(s).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

function mapSection(particular) {
  const n = norm(particular);
  let hit = byNorm.get(n);
  if (!hit) hit = baseIndex.get(stripAllParens(particular)); // model-variant fallback
  return hit
    ? { key: hit.key, captureType: hit.captureType, n }
    : { key: null, captureType: null, n };
}

// --- main ------------------------------------------------------------------
function main() {
  const wb = XLSX.readFile(CORPUS);
  const records = [];
  let totalLines = 0, mappedLines = 0;
  const unmappedCount = new Map();

  for (const sheet of wb.SheetNames) {
    if (NONJOB.has(sheet)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: "" });

    // locate header row + columns
    let hdr = -1, pc = 2, sc = 3, qc = 4;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = (rows[i] || []).map((x) => String(x).toLowerCase());
      const j = r.findIndex((x) => x.includes("particular"));
      if (j >= 0) {
        hdr = i; pc = j;
        const s = r.findIndex((x) => x.includes("specification")); sc = s >= 0 ? s : pc + 1;
        const q = r.findIndex((x) => x.includes("qty") || x.includes("quantity")); qc = q >= 0 ? q : sc + 1;
        break;
      }
    }
    if (hdr < 0) continue;

    // spec row: the row with "JOB ID"
    let specRaw = "", jobCode = "";
    for (let i = 0; i < Math.min(rows.length, hdr + 1); i++) {
      const r = rows[i] || [];
      const j = r.findIndex((x) => /job\s*id/i.test(String(x)));
      if (j >= 0) {
        // job code = first non-empty cell after the JOB ID label; spec = the long G+.. cell
        const after = r.slice(j + 1).map((x) => String(x).trim()).filter(Boolean);
        jobCode = after[0] || sheet;
        specRaw = after.find((x) => /G\s*\+|PASS|KG/i.test(x)) || after[1] || "";
        break;
      }
    }

    const lines = [];
    let partGroup = "";
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      // update part-group from any cell
      const gm = r.find((x) => isPartGroup(x));
      if (gm) partGroup = String(gm).trim().replace(/\s*:?-?\s*$/, "");
      const particular = String(r[pc] || "").trim();
      if (!particular || isMarker(particular)) continue;
      const qty = parseQty(r[qc]);
      const spec = String(r[sc] || "").trim();
      const sl = String(r[pc - 1] || r[1] || "").trim();
      const { key, captureType, n } = mapSection(particular);
      lines.push({ particular, norm: n, canon: canon(particular), sectionKey: key, captureType, spec, qty, partGroup, sl });
      totalLines++;
      if (key) mappedLines++;
      else unmappedCount.set(n, (unmappedCount.get(n) || 0) + 1);
    }

    if (lines.length < 5) continue; // not a real part list
    records.push({ sheet, jobCode, specRaw, spec: parseSpec(specRaw), lineCount: lines.length, lines });
  }

  fs.writeFileSync(OUT, JSON.stringify(records));
  // summary
  const withStops = records.filter((r) => r.spec.stops != null).length;
  const withDoor = records.filter((r) => r.spec.doorType).length;
  console.log(`Parsed ${records.length} job records.`);
  console.log(`  spec parsed: stops=${withStops}, capacity=${records.filter((r) => r.spec.capPass || r.spec.capKg).length}, doorType=${withDoor}`);
  console.log(`  lines: ${totalLines} total, ${mappedLines} mapped to a section (${Math.round(mappedLines / totalLines * 100)}%)`);
  const topUnmapped = [...unmappedCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`  top UNMAPPED particulars (norm -> count):`);
  for (const [n, c] of topUnmapped) console.log(`    ${c.toString().padStart(4)}  ${n}`);
  console.log(`\nWrote ${OUT}`);
}
main();
