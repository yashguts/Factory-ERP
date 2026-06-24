// Mine per-(section,item) quantity relationships: qty vs travel / floors / capacity.
// Goal: replace ratio-scaling with fitted models for the length/scaled sections.
const fs = require("fs");
const path = require("path");
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
async function fetchAll(t, s) { const o = []; let f = 0; for (;;) { const r = await fetch(`${URL}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } }
const flat = (x) => (Array.isArray(x) ? x[0] : x);
const capKg = (c) => { if (!c) return null; let m = /(\d+)\s*PASS/i.exec(c); if (m) return +m[1] * 68; m = /(\d+)\s*KG/i.exec(c); if (m) return +m[1]; return null; };

// least-squares qty = a + b*x; returns {a,b,r2,mae}
function fit(pts) {
  const n = pts.length; if (n < 4) return null;
  const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0), sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const d = n * sxx - sx * sx; if (Math.abs(d) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
  const my = sy / n; let ssr = 0, sst = 0, ae = 0, w20 = 0, w10 = 0;
  for (const p of pts) { const yh = a + b * p.x; ssr += (p.y - yh) ** 2; sst += (p.y - my) ** 2; ae += Math.abs(p.y - yh); const e = Math.abs(yh - p.y) / Math.max(p.y, 1); if (e <= 0.2) w20++; if (e <= 0.1) w10++; }
  return { a, b, r2: sst > 0 ? 1 - ssr / sst : 0, mae: ae / n, within20: w20 / n, within10: w10 / n, n };
}

(async () => {
  const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
  const exById = new Map(ext.map((e) => [e.job_id, e]));
  const jobs = await fetchAll("jobs", "id,floors,capacity");
  const jById = new Map(jobs.map((j) => [j.id, j]));
  const headers = await fetchAll("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const lines = await fetchAll("job_bom_lines", "job_bom_id,category,required_quantity,item:items(name)");

  // mine EVERY section; collect per (section|item) -> points with x candidates
  const data = new Map();
  for (const l of lines) {
    if (!l.category) continue;
    const jid = jobByHeader.get(l.job_bom_id); const j = jById.get(jid); const ex = exById.get(jid);
    if (!j) continue;
    const travel = ex?.travel_mm ?? null;
    const floors = j.floors ?? null;
    const kg = capKg(j.capacity);
    const q = Number(l.required_quantity) || 0;
    if (q <= 0) continue;
    const name = flat(l.item)?.name || "?";
    const key = l.category + " :: " + name;
    if (!data.has(key)) data.set(key, []);
    data.get(key).push({ q, travel, floors, kg });
  }
  // TRAVEL is only physically valid where qty scales with SHAFT HEIGHT — parts repeated
  // up the hoistway (rail clips/brackets every ~1.7m, guide rails cut to travel, governor/
  // hoist rope length, cable troughing, rail grease). Per-LANDING parts (sills, headers,
  // doors, linton, gate lock) are one-per-stop: they only correlate with travel because a
  // taller shaft has more stops. Forcing travel there would over-count a tall 2-stop job.
  // So outside this whitelist we never emit a travel model — floors/const/retrieval only.
  const SHAFT_DRIVEN = new Set([
    "RAIL CLIP", "RAIL", "Stud Anchor", "MAIN BRACKET", "COUNTER BRACKET",
    "Wire Rope Governor", "Wire Rope Main/Belt Main", "TROUGHING 50", "TROUGHING 100",
    "Mobil T-40", "Bull Dog Clip", "I-Bolt with Spring", "D-SHACKLE", "Fish Plate", "PVC CABLE HANGER",
  ]);
  // Select a model per item: const (stable), else floors/travel regression (r2 ≥ 0.55).
  const models = [];
  const rows = [...data.entries()].filter(([, v]) => v.length >= 8).sort((a, b) => b[1].length - a[1].length);
  for (const [key, pts] of rows) {
    const [section, name] = key.split(" :: ");
    const qs = pts.map((p) => p.q);
    const mean = qs.reduce((s, x) => s + x, 0) / qs.length;
    const sd = Math.sqrt(qs.reduce((s, x) => s + (x - mean) ** 2, 0) / qs.length);
    const cv = mean > 0 ? sd / mean : 99;
    const mode = qs.slice().sort((a, b) => qs.filter((x) => x === a).length - qs.filter((x) => x === b).length).pop();
    const ft = fit(pts.filter((p) => p.travel != null).map((p) => ({ x: p.travel, y: p.q })));
    const ff = fit(pts.filter((p) => p.floors != null).map((p) => ({ x: p.floors, y: p.q })));
    let model = null;
    // Select by USABLE tolerance (within-20%), not r2. The owner's insight: consumable
    // quantities (rail clip, wire rope, rail) track the SHAFT HEIGHT (travel), and the
    // exact count is immaterial — within 20% never gets re-typed. A travel regression hits
    // 75-85% within-20% where floor-scaling (the old default) manages ~28%. Keep a model
    // only if it clears 70% within-20% AND beats the const-mode baseline on the same metric.
    const modeW20 = qs.filter((x) => Math.abs(x - mode) / Math.max(x, 1) <= 0.2).length / qs.length;
    if (cv < 0.08) model = { section, name, kind: "const", v: mode };
    else {
      // Keep a regression only if it's good at BOTH tolerances: within-20% >= 70% (usable)
      // AND within-10% >= 50% (precise enough to beat exact-neighbour retrieval). A loose
      // fit that only clears 20% (e.g. Wire Rope Governor, within-10% = 33%) loses to
      // retrieval whenever a close neighbour exists — measured net-negative, so excluded.
      const allowTravel = SHAFT_DRIVEN.has(section);
      const best = [allowTravel && ft && { ...ft, predictor: "travel" }, ff && { ...ff, predictor: "floors" }].filter(Boolean).sort((a, b) => b.within10 - a.within10)[0];
      if (best && best.within20 >= 0.70 && best.within10 >= 0.50 && best.within20 > modeW20 + 0.1)
        model = { section, name, kind: best.predictor, a: +best.a.toFixed(3), b: +best.b.toFixed(6), r2: +best.r2.toFixed(2), w10: +best.within10.toFixed(2), w20: +best.within20.toFixed(2), n: best.n };
    }
    const fmt = (f, lbl) => f ? `${lbl} w10=${(100 * f.within10).toFixed(0)}/w20=${(100 * f.within20).toFixed(0)}` : `${lbl} -`;
    console.log(`${key.slice(0, 44).padEnd(45)} ${String(pts.length).padStart(3)} cv=${cv.toFixed(2)} | ${fmt(ft, "trav")} ${fmt(ff, "flr")} mode=${mode} | -> ${model ? model.kind : "RETRIEVAL"}`);
    if (model) models.push(model);
  }
  fs.writeFileSync(path.join(__dirname, "partlist-brain/data/quantity-fits.json"), JSON.stringify(models, null, 1));
  const ts = `// AUTO-GENERATED by scripts/_qty_mine.js — per-(section,item) quantity models fit from\n` +
    `// the corpus + drawing extractions. const = stable count; floors/travel = qty ≈ a + b·X\n` +
    `// (travel in mm). Regenerate after new jobs land. Do not hand-edit.\n` +
    `export interface QtyFit { section: string; name: string; kind: "const" | "floors" | "travel"; v?: number; a?: number; b?: number; }\n` +
    `export const QTY_FITS: QtyFit[] = ${JSON.stringify(models.map((m) => ({ section: m.section, name: m.name, kind: m.kind, ...(m.kind === "const" ? { v: m.v } : { a: m.a, b: m.b }) })), null, 1)};\n`;
  fs.writeFileSync(path.join(__dirname, "..", "src/lib/bom/quantity-fits.ts"), ts);
  console.log(`\nwrote ${models.length} models -> src/lib/bom/quantity-fits.ts  (const: ${models.filter((m) => m.kind === "const").length}, floors: ${models.filter((m) => m.kind === "floors").length}, travel: ${models.filter((m) => m.kind === "travel").length})`);
})();
