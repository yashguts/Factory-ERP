// Filler Weight model mining (owner's domain logic):
//  total filler weight = f(passenger capacity); fill with AHM (cheap, LESS dense) up to the
//  counter-frame HEIGHT limit (set by counter DBG); top up the required weight with CI/Plate
//  (expensive, MORE dense). Reverse-engineer: total-weight vs capacity, per-plate weights of
//  each type, and how the AHM/CI counts split by DBG.
const fs = require("fs"), path = require("path");
const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
const exBy = new Map(ext.map((e) => [e.job_id, e]));
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
const capKg = (c) => { if (!c) return null; const kg = /(\d+)\s*kg/i.exec(c); if (kg) return +kg[1]; const p = /(\d+)\s*pass/i.exec(c); if (p) return +p[1] * 68; return null; };
const typeOf = (n) => (/A\.?H\.?M/i.test(n) ? "AHM" : /C\.?I|PLATE|CASTING/i.test(n) ? "CI" : "?");
const wtOf = (n) => { const m = /([\d.]+)\s*kg/i.exec(n) || /\)\s*([\d.]+)\s*$/.exec(n); return m ? +m[1] : null; };
const dbgOf = (n) => { const m = /DBG-(\d+)/.exec(n); return m ? +m[1] : null; };
(async () => {
  const jobs = await fa("jobs", "id,job_number,capacity"); const jById = new Map(jobs.map((j) => [j.id, j]));
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,required_quantity,item:items(name)");
  const byJob = new Map();
  for (const l of ln) { if (l.category !== "Filler Weight") continue; const j = byH.get(l.job_bom_id); if (!j) continue; (byJob.get(j) || byJob.set(j, []).get(j)).push({ name: (Array.isArray(l.item) ? l.item[0] : l.item)?.name || "", qty: Number(l.required_quantity) || 0 }); }
  // per-type per-plate weight catalogue (from CI names that state kg)
  const ciWeights = new Map();
  for (const [, lines] of byJob) for (const l of lines) { const w = wtOf(l.name); if (w && typeOf(l.name) === "CI") ciWeights.set(l.name.replace(/[\d.]+\s*$/, "").trim(), w); }
  const rows = [];
  for (const [j, lines] of byJob) {
    const job = jById.get(j); const e = exBy.get(j); if (!job) continue;
    const cap = capKg(job.capacity); const cdbg = e?.dbg_counter_mm ?? lines.map((l) => dbgOf(l.name)).find(Boolean);
    let ahmQ = 0, ciQ = 0, ciWt = 0;
    for (const l of lines) { const t = typeOf(l.name); if (t === "AHM") ahmQ += l.qty; else if (t === "CI") { ciQ += l.qty; const w = wtOf(l.name); if (w) ciWt += w * l.qty; } }
    rows.push({ job: job.job_number, cap, cdbg, ahmQ, ciQ, ciWt: Math.round(ciWt) });
  }
  rows.sort((a, b) => (a.cap || 0) - (b.cap || 0));
  console.log("job          cap(kg) ctrDBG  AHMq  CIq  CIwt(kg)");
  for (const r of rows) console.log(`${(r.job || "").padEnd(12)} ${String(r.cap ?? "?").padStart(5)}  ${String(r.cdbg ?? "?").padStart(5)}   ${String(r.ahmQ).padStart(3)}  ${String(r.ciQ).padStart(3)}  ${String(r.ciWt).padStart(5)}`);
  // correlation: AHM count vs DBG; CI count vs (cap, DBG)
  const withCap = rows.filter((r) => r.cap && r.cdbg);
  console.log("\nn(with cap+dbg):", withCap.length);
})();
