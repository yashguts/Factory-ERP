// Test the owner's hypothesis: rail clip / wire rope / stud anchor qty ~ shaft size.
// For each, fit qty = a + b*X for X in {travel, bracket-count=travel/spacing, brackets,
// floors} and report how often the fit lands within 10% / 20% (a usable tolerance).
const fs = require("fs"), path = require("path");
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
const spacingOf = (n) => { if (!n) return null; const m = /brac\w*\.?\s*sp\w*[^0-9]{0,8}(\d{3,4})/i.exec(n) || /bracket\s*spac\w*[^0-9]{0,8}(\d{3,4})/i.exec(n); return m ? +m[1] : null; };
function fitTol(pairs) { // qty = a + b*x ; return {r2, within10, within20, a, b, n}
  const n = pairs.length; if (n < 6) return null;
  const sx = pairs.reduce((s, p) => s + p.x, 0), sy = pairs.reduce((s, p) => s + p.y, 0), sxx = pairs.reduce((s, p) => s + p.x * p.x, 0), sxy = pairs.reduce((s, p) => s + p.x * p.y, 0);
  const d = n * sxx - sx * sx; if (!d) return null;
  const b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n; const my = sy / n;
  let ssr = 0, sst = 0, w10 = 0, w20 = 0;
  for (const p of pairs) { const yh = a + b * p.x; ssr += (p.y - yh) ** 2; sst += (p.y - my) ** 2; const e = Math.abs(yh - p.y) / Math.max(p.y, 1); if (e <= 0.1) w10++; if (e <= 0.2) w20++; }
  return { r2: sst ? 1 - ssr / sst : 0, within10: w10 / n, within20: w20 / n, a, b, n };
}
(async () => {
  const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
  const exBy = new Map(ext.map((e) => [e.job_id, e]));
  const jobs = await fa("jobs", "id,floors"); const floorsBy = new Map(jobs.map((j) => [j.id, j.floors]));
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,required_quantity");
  const tot = new Map();
  for (const l of ln) { const j = byH.get(l.job_bom_id); if (!j) continue; const o = tot.get(j) || {}; o[l.category] = (o[l.category] || 0) + (Number(l.required_quantity) || 0); tot.set(j, o); }
  const drivers = (j) => { const e = exBy.get(j) || {}; const sp = spacingOf(e.notes); return { travel: e.travel_mm || null, "trav/spacing": e.travel_mm && sp ? e.travel_mm / sp : null, brackets: (tot.get(j) || {})["MAIN BRACKET"] || null, floors: floorsBy.get(j) || null }; };
  for (const sec of ["RAIL CLIP", "Stud Anchor", "Wire Rope Governor", "Wire Rope Main/Belt Main", "RAIL"]) {
    console.log("\n== " + sec + " ==");
    for (const dn of ["travel", "trav/spacing", "brackets", "floors"]) {
      const pairs = [];
      for (const [j, o] of tot) { const y = o[sec], x = drivers(j)[dn]; if (y != null && x != null && x > 0) pairs.push({ x, y }); }
      const f = fitTol(pairs); if (!f) continue;
      console.log(`  ${dn.padEnd(13)} r2=${f.r2.toFixed(2)}  within10%=${(100 * f.within10).toFixed(0)}%  within20%=${(100 * f.within20).toFixed(0)}%  (qty≈${f.a.toFixed(1)}+${f.b.toFixed(3)}·x, n=${f.n})`);
    }
  }
})();
