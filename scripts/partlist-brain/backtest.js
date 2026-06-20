/**
 * Layer 4 — Leave-one-out backtest (the GATE).
 *
 * For every job in the corpus, predict its part list using all OTHER jobs, then
 * compare to the real list. Reports presence (precision/recall), quantity, and
 * specification accuracy — overall and item-only — plus the end-to-end
 * "lines correct as-is" rate (present + right qty + right spec).
 *
 * Run: node scripts/partlist-brain/backtest.js
 * Out: scripts/partlist-brain/data/backtest.json
 */
const fs = require("fs");
const path = require("path");
const { buildIndex, predict } = require("./predict");

const corpus = require(path.join(__dirname, "data", "corpus.json"));
const qmodels = require(path.join(__dirname, "data", "quantity-models.json"));
const OUT = path.join(__dirname, "data", "backtest.json");

const specNorm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9x.\/+-]/g, "");

// actual aggregation: canon -> { qty, specs:Set, captureType, sectionKey }
function aggregate(lines) {
  const m = new Map();
  for (const l of lines) {
    if (!l.canon) continue;
    let e = m.get(l.canon);
    if (!e) { e = { qty: 0, hasQty: false, specs: new Set(), captureType: l.captureType, sectionKey: l.sectionKey }; m.set(l.canon, e); }
    if (l.qty != null) { e.qty += l.qty; e.hasQty = true; }
    if (l.spec) e.specs.add(specNorm(l.spec));
  }
  return m;
}

function main() {
  const idx = buildIndex(corpus, qmodels);
  const tested = corpus.filter((r) => r.spec.stops != null);

  // accumulators
  let tpAll = 0, fpAll = 0, fnAll = 0;
  let tpItem = 0, fpItem = 0, fnItem = 0;
  let qtyExact = 0, qtyWithin1 = 0, qtyDenom = 0;        // over matched item canons
  let specMatch = 0, specDenom = 0;                      // over matched item canons with a spec
  let correctAsIs = 0, asIsDenom = 0;                    // present + qty exact + spec ok (item)
  const perJob = [];
  const missByCanon = new Map();  // FN
  const fpByCanon = new Map();    // FP

  for (const rec of tested) {
    const actual = aggregate(rec.lines);
    const pred = predict(rec.spec, idx, { excludeSheet: rec.sheet });
    const predMap = new Map();
    for (const l of pred.lines) predMap.set(l.canon, l);

    let jobItemActual = 0, jobItemCorrect = 0;
    // recall side (iterate actual)
    for (const [canon, a] of actual) {
      const isItem = a.captureType === "item";
      const p = predMap.get(canon);
      if (p) { tpAll++; if (isItem) tpItem++; }
      else {
        fnAll++; if (isItem) fnItem++;
        missByCanon.set(canon, (missByCanon.get(canon) || 0) + 1);
      }
      if (isItem) {
        jobItemActual++;
        if (p) {
          // qty
          qtyDenom++;
          const dq = Math.abs((p.qty || 0) - (a.hasQty ? a.qty : (p.qty || 0)));
          const qtyOk = !a.hasQty || dq < 0.5;
          if (qtyOk) qtyExact++;
          if (!a.hasQty || dq <= 1) qtyWithin1++;
          // spec
          let specOk = true;
          if (a.specs.size) {
            specDenom++;
            const pset = new Set((p.specs || []).map(specNorm));
            specOk = [...a.specs].some((x) => pset.has(x));
            if (specOk) specMatch++;
          }
          // as-is
          asIsDenom++;
          if (qtyOk && specOk) { correctAsIs++; jobItemCorrect++; }
        }
      }
    }
    // precision side (iterate predicted)
    for (const [canon, p] of predMap) {
      if (!actual.has(canon)) {
        fpAll++; if (p.captureType === "item") fpItem++;
        fpByCanon.set(canon, (fpByCanon.get(canon) || 0) + 1);
      }
    }
    perJob.push({ sheet: rec.sheet, stops: rec.spec.stops, door: rec.spec.doorType, neighbour: pred.neighbours[0], itemActual: jobItemActual, itemCorrect: jobItemCorrect });
  }

  const pr = (tp, fp) => tp / (tp + fp || 1);
  const rc = (tp, fn) => tp / (tp + fn || 1);
  const f1 = (p, r) => (2 * p * r) / (p + r || 1);
  const pAll = pr(tpAll, fpAll), rAll = rc(tpAll, fnAll);
  const pItem = pr(tpItem, fpItem), rItem = rc(tpItem, fnItem);
  const pct = (x) => (x * 100).toFixed(1) + "%";

  const summary = {
    jobsTested: tested.length,
    presenceAll: { precision: pAll, recall: rAll, f1: f1(pAll, rAll) },
    presenceItem: { precision: pItem, recall: rItem, f1: f1(pItem, rItem) },
    qty: { exact: qtyExact / (qtyDenom || 1), within1: qtyWithin1 / (qtyDenom || 1), n: qtyDenom },
    spec: { match: specMatch / (specDenom || 1), n: specDenom },
    linesCorrectAsIs: correctAsIs / (asIsDenom || 1),
    avgJobItemCorrectFraction: perJob.reduce((a, j) => a + (j.itemActual ? j.itemCorrect / j.itemActual : 0), 0) / perJob.length,
  };

  fs.writeFileSync(OUT, JSON.stringify({ summary, perJob }, null, 0));

  console.log(`LEAVE-ONE-OUT BACKTEST  (${tested.length} jobs)\n`);
  console.log(`Presence  (did we include the right particulars?)`);
  console.log(`  ALL  parts : precision ${pct(pAll)}  recall ${pct(rAll)}  F1 ${pct(f1(pAll, rAll))}`);
  console.log(`  ITEM parts : precision ${pct(pItem)}  recall ${pct(rItem)}  F1 ${pct(f1(pItem, rItem))}`);
  console.log(`\nQuantity  (matched item parts, n=${qtyDenom})`);
  console.log(`  exact   : ${pct(summary.qty.exact)}`);
  console.log(`  within 1: ${pct(summary.qty.within1)}`);
  console.log(`\nSpecification/size  (matched item parts with a spec, n=${specDenom})`);
  console.log(`  match   : ${pct(summary.spec.match)}`);
  console.log(`\nEND-TO-END  lines correct as-is (present + qty + spec): ${pct(summary.linesCorrectAsIs)}`);
  console.log(`Avg per-job fraction of item lines correct as-is       : ${pct(summary.avgJobItemCorrectFraction)}`);

  const top = (m, label) => {
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`\nTop ${label}:`);
    for (const [c, n] of rows) console.log(`  ${String(n).padStart(4)}  ${c.slice(0, 48)}`);
  };
  top(missByCanon, "MISSED particulars (false negatives)");
  top(fpByCanon, "OVER-PREDICTED particulars (false positives)");
  console.log(`\nWrote ${OUT}`);
}
main();
