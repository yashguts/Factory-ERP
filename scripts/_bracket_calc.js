// Calc-layer test: can we COMPUTE the main-bracket count from travel + bracket spacing
// instead of copying a neighbour? levels = floor(travel/spacing)+1+floor(travel/5000 joints);
// cwt-side: B = 2*levels, Combination = 1*levels (shared rail) ; cwt-rear: B = 4*levels.
const fs = require("fs"), path = require("path");
const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
const exBy = new Map(ext.map((e) => [String(e.job_number), e]));
const spacingOf = (n) => { if (!n) return null; const m = /brac\w*\.?\s*sp\w*[^0-9]{0,8}(\d{3,4})/i.exec(n) || /bracket\s*spac\w*[^0-9]{0,8}(\d{3,4})/i.exec(n); return m ? +m[1] : null; };
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
(async () => {
  const jobs = await fa("jobs", "id,job_number"); const numById = new Map(jobs.map((j) => [j.id, j.job_number]));
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,required_quantity,item:items(name)");
  const tot = new Map(); // job_number -> {B, combo, total}
  for (const l of ln) {
    if (l.category !== "MAIN BRACKET") continue;
    const num = numById.get(byH.get(l.job_bom_id)); if (!num) continue;
    const nm = (Array.isArray(l.item) ? l.item[0] : l.item)?.name || "";
    const q = Number(l.required_quantity) || 0;
    const o = tot.get(num) || { B: 0, combo: 0, total: 0 };
    if (/combination/i.test(nm)) o.combo += q; else o.B += q;
    o.total += q; tot.set(num, o);
  }
  let n = 0, totW20 = 0, comboExact = 0, comboN = 0; const rows = [];
  for (const [num, o] of tot) {
    const e = exBy.get(num); if (!e || !e.travel_mm) continue;
    const sp = spacingOf(e.notes); if (!sp) continue;
    const levels = Math.floor(e.travel_mm / sp) + 1 + Math.floor(e.travel_mm / 5000);
    const side = /side/i.test(e.counterweight_position || "");
    const calcTotal = side ? 3 * levels : 4 * levels;
    n++;
    if (Math.abs(calcTotal - o.total) / Math.max(o.total, 1) <= 0.2) totW20++;
    if (side && o.combo > 0) { comboN++; if (Math.abs(levels - o.combo) <= 1) comboExact++; }
    if (rows.length < 14) rows.push(`${num}: calc ${calcTotal} (lvl ${levels}, ${side ? "side" : "rear"}) vs actual ${o.total} [B ${o.B} combo ${o.combo}]`);
  }
  console.log(`n=${n}  calc total within 20%: ${totW20}/${n} = ${(100 * totW20 / n).toFixed(0)}%`);
  console.log(`combo == levels (±1), cwt-side: ${comboExact}/${comboN} = ${comboN ? (100 * comboExact / comboN).toFixed(0) : 0}%`);
  console.log(rows.join("\n"));
})();
