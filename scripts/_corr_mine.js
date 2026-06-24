// Correlation miner: find quantity relationships BETWEEN sections (e.g. clips-per-bracket)
// and vs travel/floors. The qty-heavy consumables may be downstream of a common driver
// (bracket count) rather than directly travel-driven — a fixed ratio would crack them.
const fs = require("fs"), path = require("path");
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
// pearson r + best-fit ratio (slope through origin) + how often qty == round(ratio*x)
function corr(pairs) {
  const n = pairs.length; if (n < 6) return null;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n, my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0, sxy0 = 0, sxx0 = 0;
  for (const p of pairs) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy0 += p.x * p.y; sxx0 += p.x * p.x; }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const ratio = sxx0 ? sxy0 / sxx0 : 0; // least-squares slope through origin
  const exact = pairs.filter((p) => p.x > 0 && Math.round(ratio * p.x) === p.y).length / n;
  return { r, ratio, exact, n };
}
(async () => {
  const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
  const travelBy = new Map(ext.map((e) => [e.job_id, e.travel_mm]));
  const jobs = await fa("jobs", "id,floors");
  const floorsBy = new Map(jobs.map((j) => [j.id, j.floors]));
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,required_quantity");
  // per job: total qty per section
  const SEarr = ["MAIN BRACKET", "RAIL CLIP", "Stud Anchor", "RAIL", "Wire Rope Governor", "Wire Rope Main/Belt Main", "TROUGHING 50", "TROUGHING 100", "Buffer Stand", "I-Bolt with Spring", "Bull Dog Clip", "Fish Plate", "PVC CABLE HANGER", "D-SHACKLE", "Mobil T-40"];
  const SE = new Set(SEarr);
  const qty = new Map(); // job -> {section: total}
  for (const l of ln) { if (!SE.has(l.category)) continue; const j = byH.get(l.job_bom_id); if (!j) continue; const o = qty.get(j) || {}; o[l.category] = (o[l.category] || 0) + (Number(l.required_quantity) || 0); qty.set(j, o); }
  const driver = (j) => ({ "MAIN BRACKET": (qty.get(j) || {})["MAIN BRACKET"], travel_m: travelBy.get(j) ? travelBy.get(j) / 1000 : null, floors: floorsBy.get(j) });
  console.log("section            vs  driver        r     ratio   %exact   n   (best of: brackets / travel-m / floors)");
  for (const sec of SEarr) {
    const cands = [];
    for (const dname of ["MAIN BRACKET", "travel_m", "floors"]) {
      const pairs = [];
      for (const [j, o] of qty) { const y = o[sec], x = driver(j)[dname]; if (y != null && x != null && x > 0) pairs.push({ x, y }); }
      const c = corr(pairs); if (c) cands.push({ dname, ...c });
    }
    cands.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const best = cands[0]; if (!best) continue;
    const flag = best.r > 0.9 ? "  <<<" : best.exact > 0.6 ? "  <-- fixed ratio" : "";
    console.log(`${sec.padEnd(24)} ${best.dname.padEnd(12)} r=${best.r.toFixed(2)} ratio=${best.ratio.toFixed(2)} exact=${(100 * best.exact).toFixed(0)}% n=${best.n}${flag}`);
  }
})();
