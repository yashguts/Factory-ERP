// Can the bracket projection (B/C/D/F/G class, or Combination X### projection) be predicted
// from the SIDE CLEARANCE (shaft_width - car_width)/2 — dims we already extract? If yes, MAIN
// BRACKET's #1 error (default B, truth C/Combination) is crackable with no new drawing read.
const fs = require("fs"), path = require("path");
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
// projection mm from a bracket SKU name
function projOf(n) {
  const range = /\((\d+)-(\d+)\)\s*mm/.exec(n); if (range) return (+range[1] + +range[2]) / 2;
  const comb = /Combination\s+DBG-\d+X\d+X?(\d+)?/i.exec(n); if (comb && comb[1]) return +comb[1];
  const comb2 = /DBG-\d+X(\d+)\)/.exec(n); if (comb2) return +comb2[1];
  const letter = /Main\s+([A-H])\b/.exec(n); if (letter) return { B: 75, C: 130, D: 185, E: 285, F: 335, G: 385, H: 110 }[letter[1]] ?? null;
  return null;
}
const classOf = (p) => p == null ? "?" : p < 100 ? "B" : p < 160 ? "C" : p < 210 ? "D" : p < 310 ? "E" : p < 360 ? "F" : "G";
(async () => {
  const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
  const exBy = new Map(ext.map((e) => [e.job_id, e]));
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,item:items(name)");
  const byJob = new Map();
  for (const l of ln) { if (l.category !== "MAIN BRACKET") continue; const j = byH.get(l.job_bom_id); if (!j) continue; const nm = (Array.isArray(l.item) ? l.item[0] : l.item)?.name || ""; const p = projOf(nm); if (p == null) continue; if (!byJob.has(j)) byJob.set(j, []); byJob.get(j).push(p); }
  const rows = [];
  for (const [j, projs] of byJob) {
    const e = exBy.get(j); if (!e || e.shaft_width_mm == null || e.car_width_mm == null) continue;
    const clr = (e.shaft_width_mm - e.car_width_mm) / 2;
    const maxProj = Math.max(...projs); // the deepest bracket the job needs
    rows.push({ job: e.job_number, clr, maxProj, truthClass: classOf(maxProj), dbg: e.dbg_main_mm });
  }
  // correlation clr vs maxProj
  const n = rows.length, mx = rows.reduce((s, r) => s + r.clr, 0) / n, my = rows.reduce((s, r) => s + r.maxProj, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (const r of rows) { sxy += (r.clr - mx) * (r.maxProj - my); sxx += (r.clr - mx) ** 2; syy += (r.maxProj - my) ** 2; }
  console.log(`n=${n}  corr(clearance, maxProjection) r=${(sxy / Math.sqrt(sxx * syy)).toFixed(2)}`);
  // how well does clr - K map to the class? try offsets
  for (const K of [0, 30, 50, 75, 100]) {
    const hit = rows.filter((r) => classOf(r.clr - K) === r.truthClass).length;
    console.log(`  class(clearance - ${K}) == truthClass:  ${hit}/${n} = ${(100 * hit / n).toFixed(0)}%`);
  }
  console.log("\nsample:", rows.slice(0, 12).map((r) => `${r.job} clr=${r.clr.toFixed(0)} proj=${r.maxProj} ->${r.truthClass}`).join("\n        "));
})();
