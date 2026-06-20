/**
 * Evidence: RULES vs SIMILAR-JOB (neighbour copy), measured on the corpus.
 * For each job, compare what each method would produce for the high-value lines
 * against the job's ACTUAL part list.
 *   - Sized specs (guide rail main/counter, fish plate): rule = capacity-band table;
 *     neighbour = nearest job's value.
 *   - Quantities (header, sill, guide rail): rule = mined formula; neighbour = copy.
 *
 * Run: node scripts/partlist-brain/compare-rules-vs-neighbor.js
 */
const path = require("path");
const corpus = require(path.join(__dirname, "data", "corpus.json"));
const rules = require(path.join(__dirname, "data", "rules.json"));
const qmodels = require(path.join(__dirname, "data", "quantity-models.json"));
const { similarity } = require(path.join(__dirname, "predict.js")); // CommonJS neighbour similarity
const sections = require(path.join(__dirname, "..", "_packing_sections.json"));
const specHintOf = new Map(sections.map((s) => [s.key, s.specHint]));
const canonHint = (canon) => { const ks = qmodels[canon]?.sectionKeys || []; for (const k of ks) { const h = specHintOf.get(k); if (h) return h; } return null; };

const KG = 68;
const toKg = (s) => (s.capKg ? s.capKg : s.capPass ? s.capPass * KG : null);
function band(s) {
  const kg = toKg(s);
  if (s.goods) { if (kg == null) return "GoodsMR2-2.5"; if (kg < 1500) return "GoodsMR<1.5"; if (kg <= 2500) return "GoodsMR2-2.5"; return "GoodsMR3"; }
  const p = s.capPass ?? (kg != null ? Math.round(kg / KG) : null);
  if (p == null) return "13-16P"; if (p <= 10) return "4-10P"; if (p <= 16) return "13-16P"; if ((kg ?? 0) >= 4000) return "4Ton"; return ">1Ton";
}
const norm = (x) => String(x || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9x./+-]/g, "");

// collapse a job's lines: canon -> { spec(first), qty(sum) }
function byCanon(rec) {
  const m = new Map();
  for (const l of rec.lines) { if (!l.canon) continue; let e = m.get(l.canon); if (!e) { e = { spec: l.spec || "", qty: 0 }; m.set(l.canon, e); } if (l.qty != null) e.qty += l.qty; if (!e.spec && l.spec) e.spec = l.spec; }
  return m;
}
const nearest = (rec, all) => all.filter((r) => r !== rec && r.spec.stops != null).map((r) => ({ r, s: similarity(rec.spec, r.spec) })).sort((a, b) => b.s - a.s)[0]?.r;

const tested = corpus.filter((r) => r.spec.stops != null);
function applyFormula(m, stops) {
  if (!m) return null;
  switch (m.model) { case "constant": return m.value; case "stops": return stops; case "stops+1": return stops + 1; case "stops-1": return stops - 1; case "2*stops": return 2 * stops; case "2*stops+1": return 2 * stops + 1; case "linear": return Math.round(m.a * stops + m.b); default: return null; }
}

// ---- spec accuracy on sized parts ----
// band-conditioned mode: most-common actual spec for this part within each band
function bandModeTable(canon) {
  const byBand = {};
  for (const rec of tested) {
    const a = byCanon(rec).get(canon); if (!a || !a.spec) continue;
    const b = band(rec.spec); (byBand[b] ||= {}); byBand[b][a.spec] = (byBand[b][a.spec] || 0) + 1;
  }
  const out = {};
  for (const [b, m] of Object.entries(byBand)) out[b] = Object.entries(m).sort((x, y) => y[1] - x[1])[0][0];
  return out;
}
function specStat(canon, sizeKey, pos) {
  let rOk = 0, nOk = 0, hOk = 0, bmOk = 0, n = 0;
  const hint = canonHint(canon);
  const bmTable = bandModeTable(canon);
  for (const rec of tested) {
    const actual = byCanon(rec).get(canon); if (!actual || !actual.spec) continue;
    n++;
    const ruleSpec = rules.sizing[sizeKey]?.[band(rec.spec)]?.[pos];
    if (ruleSpec && norm(ruleSpec) === norm(actual.spec)) rOk++;
    if (hint && norm(hint) === norm(actual.spec)) hOk++;
    const bm = bmTable[band(rec.spec)];
    if (bm && norm(bm) === norm(actual.spec)) bmOk++;
    const nb = nearest(rec, tested); const nbSpec = nb && byCanon(nb).get(canon)?.spec;
    if (nbSpec && norm(nbSpec) === norm(actual.spec)) nOk++;
  }
  return { part: canon, n, bandRule: (100 * rOk / n).toFixed(0) + "%", mostCommon: (100 * hOk / n).toFixed(0) + "%", bandMode: (100 * bmOk / n).toFixed(0) + "%", neighbour: (100 * nOk / n).toFixed(0) + "%" };
}

// ---- qty accuracy ----
function qtyStat(canon) {
  const m = qmodels[canon]; let rOk = 0, nOk = 0, n = 0;
  for (const rec of tested) {
    const actual = byCanon(rec).get(canon); if (!actual || !(actual.qty > 0)) continue;
    n++;
    const rq = applyFormula(m, rec.spec.stops);
    if (rq != null && Math.abs(Math.round(rq) - actual.qty) < 0.5) rOk++;
    const nb = nearest(rec, tested); const nq = nb && byCanon(nb).get(canon)?.qty;
    if (nq != null && Math.abs(nq - actual.qty) < 0.5) nOk++;
  }
  return { part: canon, n, ruleModel: m?.model, rule: (100 * rOk / n).toFixed(0) + "%", neighbour: (100 * nOk / n).toFixed(0) + "%" };
}

// ---- AGGREGATE over ALL item lines (not just the 3 shown) ----
const sizing = require(path.join(__dirname, "data", "sizing-bands.json"));
(function aggregateAllItems() {
  let bmOk = 0, hOk = 0, nOk = 0, n = 0;
  for (const rec of tested) {
    const nb = nearest(rec, tested); const nbC = nb ? byCanon(nb) : null;
    for (const l of rec.lines) {
      if (l.captureType !== "item" || !l.canon || !l.spec) continue;
      n++;
      const bm = sizing[l.canon]?.[band(rec.spec)];
      if (bm && norm(bm) === norm(l.spec)) bmOk++;
      const h = canonHint(l.canon);
      if (h && norm(h) === norm(l.spec)) hOk++;
      const ns = nbC?.get(l.canon)?.spec;
      if (ns && norm(ns) === norm(l.spec)) nOk++;
    }
  }
  console.log(`AGGREGATE spec accuracy over ALL ${n} item lines (every part, not just 3):`);
  console.log(`  band-mode rule : ${(100 * bmOk / n).toFixed(1)}%`);
  console.log(`  most-common    : ${(100 * hOk / n).toFixed(1)}%`);
  console.log(`  similar-job    : ${(100 * nOk / n).toFixed(1)}%\n`);
})();

console.log("SPEC/SIZE accuracy vs actual  (RULE = capacity band, NEIGHBOUR = nearest job)\n");
console.table([
  specStat("guide rail(main)", "guide rail", "guide"),
  specStat("guide rail(counter)", "guide rail", "counter"),
  specStat("fish plate", "fish plate", "guide"),
]);
console.log("\nQUANTITY accuracy vs actual  (RULE = mined formula, NEIGHBOUR = nearest job)\n");
console.table([
  qtyStat("landing header system"),
  qtyStat("alluminium sill(landing)"),
  qtyStat("sill angle"),
  qtyStat("guide rail(main)"),
  qtyStat("troughing"),
  qtyStat("pvc cable hanger"),
]);
