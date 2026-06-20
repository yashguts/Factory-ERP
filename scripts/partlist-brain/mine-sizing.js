/**
 * Mine a band-conditioned sizing table: for every canonical part, the most-common
 * Specification WITHIN each capacity band (≥3 supporting jobs). This is the
 * data-driven replacement for the hand-parsed `Rules` sheet sizing (whose counter-
 * rail column was wrong). Backtests >= the similar-job copy on sizes, and is fully
 * deterministic + improvable (re-mine from "Ready" lists later).
 *
 * Run: node scripts/partlist-brain/mine-sizing.js
 * Out: data/sizing-bands.json  { canon: { band: spec } }
 */
const fs = require("fs");
const path = require("path");
const corpus = require(path.join(__dirname, "data", "corpus.json"));
const OUT = path.join(__dirname, "data", "sizing-bands.json");
const MIN_SUPPORT = 3;
const KG = 68;

const toKg = (s) => (s.capKg ? s.capKg : s.capPass ? s.capPass * KG : null);
function band(s) {
  const kg = toKg(s);
  if (s.goods) { if (kg == null) return "GoodsMR2-2.5"; if (kg < 1500) return "GoodsMR<1.5"; if (kg <= 2500) return "GoodsMR2-2.5"; return "GoodsMR3"; }
  const p = s.capPass ?? (kg != null ? Math.round(kg / KG) : null);
  if (p == null) return "13-16P"; if (p <= 10) return "4-10P"; if (p <= 16) return "13-16P"; if ((kg ?? 0) >= 4000) return "4Ton"; return ">1Ton";
}

// canon -> band -> { spec: count }
const agg = new Map();
for (const rec of corpus) {
  if (rec.spec.stops == null) continue;
  const b = band(rec.spec);
  const seen = new Set(); // first spec per canon per job (avoid double-count of multi-line parts)
  for (const l of rec.lines) {
    if (!l.canon || !l.spec || seen.has(l.canon)) continue;
    seen.add(l.canon);
    if (!agg.has(l.canon)) agg.set(l.canon, {});
    const byBand = agg.get(l.canon);
    (byBand[b] ||= {});
    byBand[b][l.spec] = (byBand[b][l.spec] || 0) + 1;
  }
}

const out = {};
let parts = 0, entries = 0;
for (const [canon, byBand] of agg) {
  const table = {};
  for (const [b, specs] of Object.entries(byBand)) {
    const top = Object.entries(specs).sort((x, y) => y[1] - x[1])[0];
    if (top && top[1] >= MIN_SUPPORT) { table[b] = top[0]; entries++; }
  }
  if (Object.keys(table).length) { out[canon] = table; parts++; }
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Mined band-sizing for ${parts} parts (${entries} band entries, support>=${MIN_SUPPORT}).`);
console.log("guide rail(counter):", JSON.stringify(out["guide rail(counter)"] || {}));
console.log("guide rail(main):", JSON.stringify(out["guide rail(main)"] || {}));
