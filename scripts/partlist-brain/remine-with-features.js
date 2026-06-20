/**
 * Re-mine the travel-scaled quantities using real drawing features (travel,
 * openings) instead of stops-as-a-proxy. Tests the engineering hypothesis that
 * guide-rail PIECES = 2 * ceil(travel / rail_length), and compares MAE vs the
 * stops-only model for the variable parts.
 *
 * Run: node scripts/partlist-brain/remine-with-features.js
 */
const path = require("path");
const corpus = require(path.join(__dirname, "data", "corpus.json"));
const feats = require(path.join(__dirname, "data", "features.json"));

const featBySheet = new Map(feats.map((f) => [f.sheet, f]));
const mae = (arr, fn) => arr.reduce((a, p) => a + Math.abs(fn(p) - p.qty), 0) / arr.length;
const exact = (arr, fn) => arr.filter((p) => Math.abs(Math.round(fn(p)) - p.qty) < 0.5).length / arr.length;

// gather per-job {stops, travel, openings, qty} for a given canon (qty summed)
function points(canonRe) {
  const pts = [];
  for (const rec of corpus) {
    const f = featBySheet.get(rec.sheet);
    if (!f || f.travelMm == null) continue;
    let q = 0, has = false;
    for (const l of rec.lines) { if (canonRe.test(l.canon) && l.qty != null) { q += l.qty; has = true; } }
    if (has && q > 0) pts.push({ stops: rec.spec.stops, travel: f.travelMm, openings: f.openingsPerFloor || 1, qty: q });
  }
  return pts;
}

function report(name, canonRe, opts = {}) {
  const pts = points(canonRe);
  if (pts.length < 6) { console.log(`\n${name}: only ${pts.length} pts, skip`); return; }
  console.log(`\n${name}  (n=${pts.length})`);
  // stops-only linear (current approach)
  const sx = pts.reduce((a, p) => a + p.stops, 0), sy = pts.reduce((a, p) => a + p.qty, 0);
  const sxx = pts.reduce((a, p) => a + p.stops ** 2, 0), sxy = pts.reduce((a, p) => a + p.stops * p.qty, 0);
  const a1 = (pts.length * sxy - sx * sy) / (pts.length * sxx - sx * sx), b1 = (sy - a1 * sx) / pts.length;
  console.log(`  stops linear   : qty=${a1.toFixed(2)}*stops+${b1.toFixed(2)}   MAE ${mae(pts, (p) => a1 * p.stops + b1).toFixed(2)}  exact ${(exact(pts, (p) => a1 * p.stops + b1) * 100).toFixed(0)}%`);
  if (opts.rail) {
    // pieces = perSide * ceil(travel / L); test rail lengths and per-side count
    let best = null;
    for (const L of [4500, 5000, 5500, 6000]) for (const per of [1, 2]) {
      const fn = (p) => per * Math.ceil(p.travel / L);
      const m = mae(pts, fn);
      if (!best || m < best.m) best = { L, per, m, ex: exact(pts, fn) };
    }
    console.log(`  travel formula : qty=${best.per}*ceil(travel/${best.L})           MAE ${best.m.toFixed(2)}  exact ${(best.ex * 100).toFixed(0)}%`);
  }
  if (opts.travelLinear) {
    const tx = pts.reduce((a, p) => a + p.travel, 0), txx = pts.reduce((a, p) => a + p.travel ** 2, 0), txy = pts.reduce((a, p) => a + p.travel * p.qty, 0);
    const a2 = (pts.length * txy - tx * sy) / (pts.length * txx - tx * tx), b2 = (sy - a2 * tx) / pts.length;
    console.log(`  travel linear  : qty=${(a2 * 1000).toFixed(2)}/m+${b2.toFixed(2)}        MAE ${mae(pts, (p) => a2 * p.travel + b2).toFixed(2)}  exact ${(exact(pts, (p) => a2 * p.travel + b2) * 100).toFixed(0)}%`);
  }
  if (opts.openings) {
    const fn = (p) => p.openings * p.stops + (opts.plus || 0);
    console.log(`  openings*stops : qty=open*stops+${opts.plus || 0}            MAE ${mae(pts, fn).toFixed(2)}  exact ${(exact(pts, fn) * 100).toFixed(0)}%`);
  }
}

console.log("RE-MINE with drawing features (travel / openings) vs stops-only\n" + "=".repeat(58));
report("Guide Rail (Main)", /^guide rail\(main\)/, { rail: true, travelLinear: true });
report("Guide Rail (Counter)", /^guide rail\(counter\)/, { rail: true, travelLinear: true });
report("Troughing", /^troughing/, { travelLinear: true });
report("Landing Header System", /^landing header system/, { openings: true, plus: 1 });
report("Alluminium Sill (Landing)", /^all?uminium sill\(land/, { openings: true });
report("PVC Cable Hanger", /^pvc cable hanger/, { travelLinear: true });

// ---- persist the winning travel-linear models (used at runtime when the drawing
//      gives travel; the predictor falls back to stops/k-NN otherwise) ----
const fs = require("fs");
function fitTravel(canonRe) {
  const pts = points(canonRe);
  const n = pts.length, sy = pts.reduce((a, p) => a + p.qty, 0);
  const tx = pts.reduce((a, p) => a + p.travel, 0), txx = pts.reduce((a, p) => a + p.travel ** 2, 0), txy = pts.reduce((a, p) => a + p.travel * p.qty, 0);
  const perMm = (n * txy - tx * sy) / (n * txx - tx * tx), b = (sy - perMm * tx) / n;
  return { kind: "travelLinear", perMm: +perMm.toFixed(6), b: +b.toFixed(2), n, mae: +mae(pts, (p) => perMm * p.travel + b).toFixed(2) };
}
const travelModels = {
  "guide rail(main)": fitTravel(/^guide rail\(main\)/),
  "guide rail(counter)": fitTravel(/^guide rail\(counter\)/),
  "troughing": fitTravel(/^troughing/),
};
fs.writeFileSync(path.join(__dirname, "data", "travel-models.json"), JSON.stringify(travelModels));
console.log("\nWrote data/travel-models.json (used at runtime when drawing travel is available).");
