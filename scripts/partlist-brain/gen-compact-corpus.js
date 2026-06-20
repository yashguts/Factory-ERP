/**
 * Emit the runtime artifacts the in-app brain needs (the full corpus.json is
 * 7.8MB/gitignored — too big to bundle):
 *   src/lib/partlist/corpus-compact.json  — neighbour corpus for k-NN copy
 *     [{ sheet, spec, lines:[{canon, sectionKey, spec, qty, captureType}] }]
 *   src/lib/partlist/section-groups.json  — sectionKey -> part-group (PART A..E)
 *     for the checklist UI grouping + per-group bulk-acknowledge.
 *
 * Run: node scripts/partlist-brain/gen-compact-corpus.js
 */
const fs = require("fs");
const path = require("path");
const corpus = require(path.join(__dirname, "data", "corpus.json"));
const sections = require(path.join(__dirname, "..", "_packing_sections.json")); // canonical order
const OUT = path.join(__dirname, "..", "..", "src", "lib", "partlist");
fs.mkdirSync(OUT, { recursive: true });

// co-locate the runtime model artifacts so the app imports them from one dir
for (const f of ["quantity-models.json", "travel-models.json", "rules.json", "templates.json", "sizing-bands.json", "partlist-overrides.json"]) {
  fs.copyFileSync(path.join(__dirname, "data", f), path.join(OUT, f));
}

// (Neighbour corpus removed — the runtime predictor is rules-only, no "similar job" copy.)

// ---- dominant part-group per sectionKey ----
const votes = new Map();
for (const r of corpus) for (const l of r.lines) {
  if (!l.sectionKey) continue;
  const pg = (l.partGroup || "").trim().toUpperCase();
  if (!/^PART [A-E]$/.test(pg)) continue;
  if (!votes.has(l.sectionKey)) votes.set(l.sectionKey, new Map());
  const m = votes.get(l.sectionKey); m.set(pg, (m.get(pg) || 0) + 1);
}
const dominant = (k) => { const m = votes.get(k); if (!m) return null; return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; };

// walk template in canonical order, carry-forward group across "(none)" gaps
const groupOf = {};
let last = "PART A";
for (const s of sections) { const g = dominant(s.key) || last; groupOf[s.key] = g; last = g; }
fs.writeFileSync(path.join(OUT, "section-groups.json"), JSON.stringify(groupOf));

// ---- summary + representative members per group (to name them) ----
const byGroup = {};
for (const s of sections) { (byGroup[groupOf[s.key]] ||= []).push(s.label); }
const sz = (p) => (fs.statSync(p).size / 1024).toFixed(0) + "KB";
console.log(`section-groups.json: ${Object.keys(groupOf).length} sections, ${sz(path.join(OUT, "section-groups.json"))}`);
console.log(`copied runtime artifacts: quantity-models, travel-models, rules, templates\n`);
for (const g of ["PART A", "PART B", "PART C", "PART D", "PART E"]) {
  const items = byGroup[g] || [];
  console.log(`${g} (${items.length}): ${items.slice(0, 10).join(" · ")}`);
}
