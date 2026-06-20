/**
 * Sweep: does top-K consensus beat single-neighbour copy? Leave-one-out over the
 * corpus for several (k, threshold) configs, reporting the same metrics as backtest.
 *
 * Run: node scripts/partlist-brain/tune-consensus.js
 */
const path = require("path");
const { buildIndex, predict } = require("./predict");
const corpus = require(path.join(__dirname, "data", "corpus.json"));
const qmodels = require(path.join(__dirname, "data", "quantity-models.json"));
const travel = require(path.join(__dirname, "data", "travel-models.json"));

const specNorm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9x.\/+-]/g, "");
function aggregate(lines) {
  const m = new Map();
  for (const l of lines) {
    if (!l.canon) continue;
    let e = m.get(l.canon);
    if (!e) { e = { qty: 0, hasQty: false, specs: new Set(), captureType: l.captureType }; m.set(l.canon, e); }
    if (l.qty != null) { e.qty += l.qty; e.hasQty = true; }
    if (l.spec) e.specs.add(specNorm(l.spec));
  }
  return m;
}

const idx = buildIndex(corpus, qmodels, travel);
const tested = corpus.filter((r) => r.spec.stops != null);

function run(opts) {
  let tpI = 0, fpI = 0, fnI = 0, qN = 0, qOk = 0, sN = 0, sOk = 0, asis = 0, asisN = 0;
  for (const rec of tested) {
    const actual = aggregate(rec.lines);
    const pred = predict(rec.spec, idx, { excludeSheet: rec.sheet, ...opts });
    const pm = new Map(pred.lines.map((l) => [l.canon, l]));
    for (const [canon, a] of actual) {
      const isItem = a.captureType === "item";
      const p = pm.get(canon);
      if (p) { if (isItem) tpI++; } else if (isItem) fnI++;
      if (isItem && p) {
        qN++; const dq = Math.abs((p.qty || 0) - (a.hasQty ? a.qty : (p.qty || 0)));
        const qok = !a.hasQty || dq < 0.5; if (qok) qOk++;
        let sok = true;
        if (a.specs.size) { sN++; const ps = new Set((p.specs || []).map(specNorm)); sok = [...a.specs].some((x) => ps.has(x)); if (sok) sOk++; }
        asisN++; if (qok && sok) asis++;
      }
    }
    for (const [canon, p] of pm) if (!actual.has(canon) && p.captureType === "item") fpI++;
  }
  const pr = tpI / (tpI + fpI || 1), rc = tpI / (tpI + fnI || 1);
  return { precision: pr, recall: rc, f1: 2 * pr * rc / (pr + rc || 1), qty: qOk / (qN || 1), spec: sOk / (sN || 1), asis: asis / (asisN || 1) };
}

const pct = (x) => (x * 100).toFixed(1).padStart(5);
const configs = [
  { name: "single-neighbour (baseline)", opts: {} },
  { name: "consensus k=5 t=0.30", opts: { consensus: true, k: 5, threshold: 0.30 } },
  { name: "consensus k=5 t=0.40", opts: { consensus: true, k: 5, threshold: 0.40 } },
  { name: "consensus k=5 t=0.50", opts: { consensus: true, k: 5, threshold: 0.50 } },
  { name: "consensus k=7 t=0.35", opts: { consensus: true, k: 7, threshold: 0.35 } },
  { name: "consensus k=7 t=0.45", opts: { consensus: true, k: 7, threshold: 0.45 } },
  { name: "consensus k=9 t=0.40", opts: { consensus: true, k: 9, threshold: 0.40 } },
];
console.log("config                          prec  recall  F1    qty   spec  as-is");
for (const c of configs) {
  const r = run(c.opts);
  console.log(`${c.name.padEnd(30)} ${pct(r.precision)} ${pct(r.recall)} ${pct(r.f1)} ${pct(r.qty)} ${pct(r.spec)} ${pct(r.asis)}`);
}
