/**
 * Layer 2 — Quantity miner.
 *
 * For each canonical part (model/supplier variants collapsed), fit qty as a
 * function of `stops` from the corpus, choosing the simplest model that fits:
 *   constant | =stops | =stops+1 | =stops-1 | =2*stops | =2*stops+1 | linear(lsq)
 * Falls back to constant(median) when nothing scales. Records fit error so the
 * predictor + report know how much to trust each.
 *
 * (stops is a proxy for travel; guide-rail / troughing keep residual variance
 * that the drawing's real travel will tighten at runtime.)
 *
 * Run:  node scripts/partlist-brain/mine-quantities.js
 * Out:  scripts/partlist-brain/data/quantity-models.json
 */
const fs = require("fs");
const path = require("path");

const corpus = require(path.join(__dirname, "data", "corpus.json"));
const OUT = path.join(__dirname, "data", "quantity-models.json");

const round = (x) => Math.round(x);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mode = (a) => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((p, q) => q[1] - p[1])[0][0]; };

// candidate predictors keyed by name
const FORMS = {
  "stops": (s) => s,
  "stops+1": (s) => s + 1,
  "stops-1": (s) => s - 1,
  "2*stops": (s) => 2 * s,
  "2*stops+1": (s) => 2 * s + 1,
};

function fitLinear(pts) {
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.stops, 0);
  const sy = pts.reduce((a, p) => a + p.qty, 0);
  const sxx = pts.reduce((a, p) => a + p.stops * p.stops, 0);
  const sxy = pts.reduce((a, p) => a + p.stops * p.qty, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  return { a, b };
}

function score(pts, fn) {
  let err = 0, exact = 0;
  for (const p of pts) { const pred = round(fn(p.stops)); err += Math.abs(pred - p.qty); if (Math.abs(pred - p.qty) < 0.5) exact++; }
  return { mae: err / pts.length, exactRate: exact / pts.length };
}

function main() {
  // aggregate: per (sheet, canon) -> sum qty across non-null qty lines
  const agg = new Map(); // canon -> { label, points:[{stops,qty}], sheets:Set, sectionKeys:Set }
  const capVote = new Map(); // canon -> {item, free} counts
  const lineCountVote = new Map(); // canon -> [#lines per sheet]
  for (const rec of corpus) {
    const stops = rec.spec.stops;
    const perCanon = new Map(); // canon -> {qty, label, keys:Set, nLines}
    for (const l of rec.lines) {
      if (!l.canon) continue;
      let e = perCanon.get(l.canon);
      if (!e) { e = { qty: 0, has: false, label: l.particular, keys: new Set(), nLines: 0 }; perCanon.set(l.canon, e); }
      if (l.qty != null) { e.qty += l.qty; e.has = true; }
      if (l.sectionKey) e.keys.add(l.sectionKey);
      e.nLines++;
      const cv = capVote.get(l.canon) || { item: 0, free: 0 };
      if (l.captureType === "free") cv.free++; else if (l.captureType === "item") cv.item++;
      capVote.set(l.canon, cv);
    }
    for (const [canon, e] of perCanon) {
      let g = agg.get(canon);
      if (!g) { g = { label: e.label, points: [], sheets: new Set(), sectionKeys: new Set() }; agg.set(canon, g); }
      g.sheets.add(rec.sheet);
      for (const k of e.keys) g.sectionKeys.add(k);
      if (stops != null && e.has && e.qty > 0) g.points.push({ stops, qty: e.qty });
      const lc = lineCountVote.get(canon) || []; lc.push(e.nLines); lineCountVote.set(canon, lc);
    }
  }

  const models = {};
  for (const [canon, g] of agg) {
    const pts = g.points;
    const cv = capVote.get(canon) || { item: 0, free: 0 };
    const captureType = cv.free > cv.item ? "free" : "item";
    const lc = lineCountVote.get(canon) || [];
    const avgLines = lc.length ? lc.reduce((a, b) => a + b, 0) / lc.length : 1;
    const multiInstance = avgLines >= 1.6; // recurs with several sizes per sheet
    const base = { label: g.label, freq: g.sheets.size, n: pts.length, sectionKeys: [...g.sectionKeys], captureType, multiInstance, avgLines: +avgLines.toFixed(2) };
    if (pts.length < 3) {
      // too few to fit -> constant from whatever we have (or mark presence-only)
      const qs = pts.map((p) => p.qty);
      models[canon] = { ...base, model: "constant", value: qs.length ? mode(qs) : null, mae: null, exactRate: null, source: "knn", weak: true };
      continue;
    }
    const candidates = [];
    // constant
    const med = round(median(pts.map((p) => p.qty)));
    candidates.push({ model: "constant", value: med, ...score(pts, () => med), complexity: 0 });
    // fixed forms
    for (const [name, fn] of Object.entries(FORMS)) candidates.push({ model: name, ...score(pts, fn), complexity: 1 });
    // linear
    const lin = fitLinear(pts);
    if (lin) candidates.push({ model: "linear", a: +lin.a.toFixed(3), b: +lin.b.toFixed(3), ...score(pts, (s) => lin.a * s + lin.b), complexity: 2 });
    // choose: lowest MAE, then lowest complexity, then highest exactRate
    candidates.sort((p, q) => p.mae - q.mae || p.complexity - q.complexity || q.exactRate - p.exactRate);
    const best = candidates[0];
    // A formula is trustworthy only if it nails most jobs and the part isn't a
    // multi-size block (those are copied per-line from the nearest neighbour).
    const reliable = !multiInstance && (best.exactRate >= 0.6 || best.mae <= 0.75);
    models[canon] = { ...base, ...best, source: reliable ? "formula" : "knn" };
  }

  fs.writeFileSync(OUT, JSON.stringify(models));

  // ---- summary ----
  const all = Object.values(models);
  const common = all.filter((m) => m.freq >= 10);
  const relItem = common.filter((m) => m.source === "formula" && m.captureType === "item").length;
  const knnItem = common.filter((m) => m.source === "knn" && m.captureType === "item").length;
  const free = common.filter((m) => m.captureType === "free").length;
  console.log(`Mined ${all.length} canonical parts. Among the ${common.length} common (freq>=10):`);
  console.log(`  item w/ reliable formula : ${relItem}`);
  console.log(`  item -> k-NN copy        : ${knnItem}`);
  console.log(`  free (fastener/consum.)  : ${free}\n`);

  const rows = Object.entries(models).filter(([, m]) => m.freq >= 20 && m.captureType === "item")
    .sort((a, b) => b[1].freq - a[1].freq);
  console.log("ITEM parts (freq>=20)  [src] model        exact  mae   part");
  for (const [canon, m] of rows.slice(0, 45)) {
    const desc = m.model === "constant" ? `=${m.value}` : m.model === "linear" ? `${m.a}s+${m.b}` : m.model;
    console.log(
      `  ${(m.source === "formula" ? "F" : "k")}  ${desc.padEnd(11)} ${m.exactRate != null ? (m.exactRate * 100).toFixed(0).padStart(4) + "%" : "  - "} ${m.mae != null ? m.mae.toFixed(2).padStart(5) : "   - "}  ${m.label.slice(0, 36)}`
    );
  }
  console.log(`\nWrote ${OUT}`);
}
main();
