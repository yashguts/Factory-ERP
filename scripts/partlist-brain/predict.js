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

function buildIndex(corpus, quantityModels) {
  return { corpus, q: quantityModels || {} };
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

/**
 * Predict a part list for targetSpec.
 * Strategy v1: nearest-neighbour copy + formula qty refinement.
 *   - structure & specs: from the single best neighbour
 *   - qty: reliable formula(stops) when available, else neighbour's qty
 */
function predict(target, idx, opts = {}) {
  const { excludeSheet } = opts;
  const ranked = [];
  for (const rec of idx.corpus) {
    if (excludeSheet && rec.sheet === excludeSheet) continue;
    ranked.push({ rec, sim: similarity(target, rec.spec) });
  }
  ranked.sort((a, b) => b.sim - a.sim);
  if (!ranked.length) return { lines: [], neighbours: [] };
  const best = ranked[0];
  const stops = target.stops != null ? target.stops : best.rec.spec.stops;

  // collapse the neighbour's lines to one entry per canon (sum qty, keep specs)
  const byCanon = new Map();
  for (const l of best.rec.lines) {
    if (!l.canon) continue;
    let e = byCanon.get(l.canon);
    if (!e) { e = { canon: l.canon, sectionKey: l.sectionKey, captureType: l.captureType, particular: l.particular, lines: [] }; byCanon.set(l.canon, e); }
    e.lines.push({ spec: l.spec, qty: l.qty });
  }

  const out = [];
  for (const [canon, e] of byCanon) {
    const m = idx.q[canon];
    const neighbourQty = e.lines.reduce((a, x) => a + (x.qty || 0), 0);
    let qty = neighbourQty, qtySource = "knn";
    if (m && m.source === "formula" && stops != null) {
      const f = applyFormula(m, stops);
      if (f != null && f >= 0) { qty = f; qtySource = "formula"; }
    }
    out.push({
      canon, sectionKey: e.sectionKey, captureType: e.captureType, particular: e.particular,
      specs: e.lines.map((x) => x.spec).filter(Boolean),
      qty, qtySource,
      provenance: { neighbour: best.rec.sheet, sim: +best.sim.toFixed(3), formula: m && m.source === "formula" ? m.model : null },
      confidence: +best.sim.toFixed(3),
    });
  }
  return { lines: out, neighbours: ranked.slice(0, 5).map((r) => ({ sheet: r.rec.sheet, sim: +r.sim.toFixed(3) })) };
}

module.exports = { buildIndex, predict, similarity, toKg, applyFormula };
