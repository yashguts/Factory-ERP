const fs = require("fs"), path = require("path");
const ext = require("./partlist-brain/data/drawing-extractions.json");
const exBy = new Map(ext.map((e) => [e.job_id, e]));
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
(async () => {
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,item:items(name)");
  let mC = 0, mM = 0, n = 0; const rows = [];
  for (const l of ln) {
    if (l.category !== "MAIN BRACKET") continue;
    const j = byH.get(l.job_bom_id); if (!j) continue;
    const nm = (Array.isArray(l.item) ? l.item[0] : l.item)?.name || "";
    const dm = /DBG-(\d+)/.exec(nm); if (!dm) continue;
    const bdbg = +dm[1]; const e = exBy.get(j); if (!e) continue;
    if (e.dbg_counter_mm == null && e.dbg_main_mm == null) continue;
    n++;
    if (e.dbg_counter_mm != null && Math.abs(bdbg - e.dbg_counter_mm) <= 40) mC++;
    if (e.dbg_main_mm != null && Math.abs(bdbg - e.dbg_main_mm) <= 40) mM++;
    if (rows.length < 14) rows.push(`bktDBG=${bdbg}  dbg_counter=${e.dbg_counter_mm}  dbg_main=${e.dbg_main_mm}`);
  }
  console.log("combination bracket DBG matches (±40):  dbg_counter:", mC + "/" + n, " dbg_main:", mM + "/" + n);
  console.log(rows.join("\n"));
})();
