/**
 * Layer 2 — Part-list predictor (pure, reused by backtest and runtime).
 *
 * Mirrors how the engineer actually works: start from the MOST SIMILAR past job,
 * copy its part-list structure, then refine quantities by mined formulas (and,
 * later, sizes by capacity-band rules). Every predicted line carries provenance.
 *
 *   const idx = buildIndex(corpus, quantityModels);
 *   const out = predict(targetSpec, idx, { excludeSheet });
 *
 * targetSpec: { stops, capPass, capKg, doorType, driveType, home, goods, v3f }
 */
const KG_PER_PASS = 68;

function toKg(spec) {
  if (spec.capKg) return spec.capKg;
  if (spec.capPass) return spec.capPass * KG_PER_PASS;
  return null;
}

// door families — part-list structure is driven mostly by door type
const DOOR_FAMILY = {
  ACO: "auto", AT: "auto", AFF: "auto", CO: "auto", AUTO: "auto",
  MT: "manual", TELESCOPIC: "manual", MANUAL: "manual",
  COLLAPSIBLE: "collapsible", COLLAPSIBEL: "collapsible",
  SWING: "swing", SWS: "swing", IMPERFORATED: "swing",
  DUMB: "dumb", DUMBWAITER: "dumb",
};
const fam = (d) => DOOR_FAMILY[d] || (d || "?");

function similarity(a, b) {
  // stops
  const ds = (a.stops != null && b.stops != null) ? Math.abs(a.stops - b.stops) : 4;
  const sStops = Math.exp(-((ds / 2) ** 2));
  // capacity
  const ka = toKg(a), kb = toKg(b);
  let sCap = 0.4;
  if (ka != null && kb != null) sCap = Math.exp(-(((ka - kb) / 220) ** 2));
  // door
  let sDoor = 0.15;
  if (a.doorType && b.doorType) sDoor = a.doorType === b.doorType ? 1 : (fam(a.doorType) === fam(b.doorType) ? 0.6 : 0.15);
  // drive
  let sDrive = 0.4;
  if (a.driveType && b.driveType) sDrive = a.driveType === b.driveType ? 1 : 0.35;
  // home/goods flags strongly change the part list
  const sFlag = ((a.home === b.home ? 1 : 0) + (a.goods === b.goods ? 1 : 0)) / 2;
  return 0.34 * sDoor + 0.24 * sStops + 0.22 * sCap + 0.10 * sDrive + 0.10 * sFlag;
}

function buildIndex(corpus, quantityModels, travelModels) {
  return { corpus, q: quantityModels || {}, travel: travelModels || {} };
}

function applyFormula(m, stops) {
  if (!m) return null;
  switch (m.model) {
    case "constant": return m.value;
    case "stops": return stops;
    case "stops+1": return stops + 1;
    case "stops-1": return stops - 1;
    case "2*stops": return 2 * stops;
    case "2*stops+1": return 2 * stops + 1;
    case "linear": return Math.round(m.a * stops + m.b);
    default: return null;
  }
}

// collapse one job's lines to one entry per canon (sum qty, keep specs)
function collapse(rec) {
  const byCanon = new Map();
  for (const l of rec.lines) {
    if (!l.canon) continue;
    let e = byCanon.get(l.canon);
    if (!e) { e = { canon: l.canon, sectionKey: l.sectionKey, captureType: l.captureType, particular: l.particular, qty: 0, specs: [] }; byCanon.set(l.canon, e); }
    if (l.qty != null) e.qty += l.qty;
    if (l.spec) e.specs.push(l.spec);
  }
  return byCanon;
}

// pick the value with the most summed weight (robust mode for discrete qtys/specs)
function weightedMode(pairs) { // [{v, w}]
  const m = new Map();
  for (const { v, w } of pairs) m.set(v, (m.get(v) || 0) + w);
  let best = null;
  for (const [v, w] of m) if (!best || w > best.w) best = { v, w };
  return best ? best.v : null;
}

/**
 * Predict a part list for targetSpec.
 *   single-neighbour (default): copy the most similar job, refine qty by formula/travel.
 *   consensus (opts.consensus): vote each part across the top-K neighbours; include a
 *     part if its weighted support >= opts.threshold; qty/spec by weighted consensus.
 */
function predict(target, idx, opts = {}) {
  const { excludeSheet, consensus = false, k = 5, threshold = 0.4 } = opts;
  const ranked = [];
  for (const rec of idx.corpus) {
    if (excludeSheet && rec.sheet === excludeSheet) continue;
    ranked.push({ rec, sim: similarity(target, rec.spec) });
  }
  ranked.sort((a, b) => b.sim - a.sim);
  if (!ranked.length) return { lines: [], neighbours: [] };
  const stops = target.stops != null ? target.stops : ranked[0].rec.spec.stops;

  const qtyOf = (canon, fallbackQty) => {
    const m = idx.q[canon];
    const tm = idx.travel[canon];
    if (tm && tm.kind === "travelLinear" && target.travelMm != null) {
      const t = Math.round(tm.perMm * target.travelMm + tm.b);
      if (t > 0) return { qty: t, src: "travel" };
    }
    if (m && m.source === "formula" && stops != null) {
      const f = applyFormula(m, stops);
      if (f != null && f >= 0) return { qty: f, src: "formula" };
    }
    return { qty: fallbackQty, src: "knn" };
  };

  if (!consensus) {
    const best = ranked[0];
    const out = [];
    for (const [canon, e] of collapse(best.rec)) {
      const { qty, src } = qtyOf(canon, e.qty);
      out.push({ canon, sectionKey: e.sectionKey, captureType: e.captureType, particular: e.particular,
        specs: e.specs, qty, qtySource: src,
        provenance: { neighbour: best.rec.sheet, sim: +best.sim.toFixed(3) }, confidence: +best.sim.toFixed(3) });
    }
    return { lines: out, neighbours: ranked.slice(0, 5).map((r) => ({ sheet: r.rec.sheet, sim: +r.sim.toFixed(3) })) };
  }

  // ---- consensus over top-K ----
  const top = ranked.slice(0, k).filter((r) => r.sim > 0);
  const totalW = top.reduce((a, r) => a + r.sim, 0) || 1;
  const agg = new Map(); // canon -> { support, specVotes:[], qtyVotes:[], meta }
  for (const { rec, sim } of top) {
    for (const [canon, e] of collapse(rec)) {
      let g = agg.get(canon);
      if (!g) { g = { support: 0, specVotes: [], qtyVotes: [], sectionKey: e.sectionKey, captureType: e.captureType, particular: e.particular }; agg.set(canon, g); }
      g.support += sim;
      for (const s of e.specs) g.specVotes.push({ v: s, w: sim });
      g.qtyVotes.push({ v: e.qty, w: sim });
    }
  }
  const out = [];
  for (const [canon, g] of agg) {
    const support = g.support / totalW;
    if (support < threshold) continue;
    const knnQty = weightedMode(g.qtyVotes);
    const { qty, src } = qtyOf(canon, knnQty);
    const spec = weightedMode(g.specVotes);
    out.push({ canon, sectionKey: g.sectionKey, captureType: g.captureType, particular: g.particular,
      specs: spec ? [spec] : [], qty, qtySource: src,
      provenance: { support: +support.toFixed(2), k: top.length }, confidence: +support.toFixed(3) });
  }
  return { lines: out, neighbours: top.map((r) => ({ sheet: r.rec.sheet, sim: +r.sim.toFixed(3) })) };
}

module.exports = { buildIndex, predict, similarity, toKg, applyFormula };
