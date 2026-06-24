// Is the MAIN BRACKET projection class (B/C/D/E/F/G/H) derivable from the extracted
// shaft/car/DBG dims? Join the extraction dataset to each job's bracket classes.
const fs = require("fs");
const path = require("path");
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
async function fetchAll(table, select) {
  const out = []; let off = 0;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`, { headers: { ...H, "Range-Unit": "items", Range: `${off}-${off + 999}` } });
    const c = await r.json(); out.push(...c); if (c.length < 1000) return out; off += 1000;
  }
}
(async () => {
  const ext = JSON.parse(fs.readFileSync(path.join(__dirname, "partlist-brain/data/drawing-extractions.json"), "utf8"));
  const byId = new Map(ext.map((e) => [e.job_id, e]));
  const headers = await fetchAll("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const lines = await fetchAll("job_bom_lines", "job_bom_id,category,item:items(name)");
  const classByJob = new Map();
  for (const l of lines) {
    if (l.category !== "MAIN BRACKET") continue;
    const name = (Array.isArray(l.item) ? l.item[0] : l.item)?.name || "";
    const m = /Main ([A-Z]) \((\d+)-(\d+)\)/.exec(name);
    if (!m) continue;
    const jid = jobByHeader.get(l.job_bom_id);
    if (!byId.has(jid)) continue;
    if (!classByJob.has(jid)) classByJob.set(jid, []);
    classByJob.get(jid).push({ cls: m[1], lo: +m[2], hi: +m[3] });
  }
  console.log("extracted jobs with projection-class brackets:", classByJob.size);
  console.log("job        cls(mid)        sw    sd    cw    cd   dbgM | (sw-dbg)/2 (sd-dbg)/2 (sw-cw)/2 (sd-cd)/2");
  for (const [jid, classes] of classByJob) {
    const e = byId.get(jid);
    const sw = e.shaft_width_mm, sd = e.shaft_depth_mm, cw = e.car_width_mm, cd = e.car_depth_mm, dbg = e.dbg_main_mm;
    const proj = classes.map((c) => `${c.cls}(${(c.lo + c.hi) / 2})`).join(",");
    const g = (a, b) => (a != null && b != null ? Math.round((a - b) / 2) : "?");
    console.log(`${(e.job_number || "").padEnd(10)} ${proj.padEnd(14)} ${String(sw).padEnd(5)} ${String(sd).padEnd(5)} ${String(cw).padEnd(5)} ${String(cd).padEnd(5)} ${String(dbg).padEnd(4)} | ${String(g(sw, dbg)).padStart(7)} ${String(g(sd, dbg)).padStart(9)} ${String(g(sw, cw)).padStart(8)} ${String(g(sd, cd)).padStart(8)}`);
  }
})();
