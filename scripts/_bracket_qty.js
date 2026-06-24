// Hypothesis: the length-section quantities are PER-BRACKET, and bracket count =
// travel / bracket_spacing. Parse spacing from the extraction notes, compute bracket
// count, and test whether qty fits bracket-count better than travel alone.
const fs = require("fs"), path = require("path");
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
async function fetchAll(t, s) { const o = []; let f = 0; for (;;) { const r = await fetch(`${URL}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } }
const flat = (x) => (Array.isArray(x) ? x[0] : x);
function fit(pts) { const n = pts.length; if (n < 5) return null; const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0), sxx = pts.reduce((s, p) => s + p.x * p.x, 0), sxy = pts.reduce((s, p) => s + p.x * p.y, 0); const d = n * sxx - sx * sx; if (!d) return null; const b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n; const my = sy / n; let ssr = 0, sst = 0, ae = 0; for (const p of pts) { const yh = a + b * p.x; ssr += (p.y - yh) ** 2; sst += (p.y - my) ** 2; ae += Math.abs(p.y - yh); } return { a, b, r2: sst ? 1 - ssr / sst : 0, mae: ae / n, n }; }
// parse "bracket spac.. NNNN" / "BRAC.SP NNNN" / "bracket space NNNN" from notes
function spacingOf(notes) { if (!notes) return null; const m = /brac\w*\.?\s*sp\w*[^0-9]{0,8}(\d{3,4})/i.exec(notes) || /bracket\s*spac\w*[^0-9]{0,8}(\d{3,4})/i.exec(notes); return m ? +m[1] : null; }

(async () => {
  const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
  const exById = new Map(ext.map((e) => [e.job_id, e]));
  const sp = ext.map((e) => spacingOf(e.notes)).filter(Boolean);
  console.log(`bracket spacing parsed from notes: ${sp.length}/${ext.length}  (values: ${[...new Set(sp)].sort((a,b)=>a-b).join(", ")})`);
  const headers = await fetchAll("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const lines = await fetchAll("job_bom_lines", "job_bom_id,category,required_quantity,item:items(name)");
  const TARGET = ["RAIL CLIP", "Stud Anchor", "RAIL", "MAIN BRACKET"];
  const data = new Map();
  for (const l of lines) {
    if (!TARGET.includes(l.category)) continue;
    const jid = jobByHeader.get(l.job_bom_id); const e = exById.get(jid); if (!e || !e.travel_mm) continue;
    const spacing = spacingOf(e.notes); if (!spacing) continue;
    const brackets = e.travel_mm / spacing;
    const name = flat(l.item)?.name || "?"; const key = l.category + " :: " + name;
    if (!data.has(key)) data.set(key, []);
    data.get(key).push({ q: Number(l.required_quantity) || 0, travel: e.travel_mm, brackets });
  }
  console.log("\nsection :: item                              n  | qty~travel  vs  qty~brackets(travel/spacing)");
  for (const [key, pts] of [...data.entries()].filter(([, v]) => v.length >= 6).sort((a, b) => b[1].length - a[1].length)) {
    const ftrav = fit(pts.map((p) => ({ x: p.travel, y: p.q })));
    const fbrk = fit(pts.map((p) => ({ x: p.brackets, y: p.q })));
    const f = (x) => x ? `r2=${x.r2.toFixed(2)} mae=${x.mae.toFixed(1)}` : "-";
    console.log(`${key.slice(0, 42).padEnd(43)} ${String(pts.length).padStart(3)} | trav ${f(ftrav).padEnd(18)} brk ${f(fbrk)}${fbrk && fbrk.r2 > 0.85 ? "  <<< per-bracket!" : ""}`);
  }
})();
