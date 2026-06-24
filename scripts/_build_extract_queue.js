// Build the drawing-extraction work queue: every COMPLETE-BOM job that has a
// locally-downloaded GA PDF. Output: scripts/_extract_queue.json
// [{ job_id, job_number, pdf, drive_type, floors, capacity }]
const fs = require("fs");
const path = require("path");

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchAll(table, select) {
  const out = [];
  let off = 0;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
      headers: { ...H, "Range-Unit": "items", Range: `${off}-${off + 999}` },
    });
    const chunk = await r.json();
    out.push(...chunk);
    if (chunk.length < 1000) return out;
    off += 1000;
  }
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "_drawing_manifest.json"), "utf8"));
  const byId = new Map(manifest.map((m) => [m.id, m]));
  // complete jobs = those with a RAIL BOM section (same definition as the backtest)
  const headers = await fetchAll("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const railLines = await fetchAll("job_bom_lines", "job_bom_id,category");
  const completeJobs = new Set();
  for (const l of railLines) if (l.category === "RAIL") { const j = jobByHeader.get(l.job_bom_id); if (j) completeJobs.add(j); }

  const queue = [];
  for (const id of completeJobs) {
    const m = byId.get(id);
    if (!m) continue; // no local PDF
    const pdf = path.resolve(__dirname, "_drawing_pdfs", path.basename(m.file));
    if (!fs.existsSync(pdf)) continue;
    queue.push({ job_id: id, job_number: m.job_number, pdf, drive_type: m.drive_type, floors: m.floors, capacity: m.capacity });
  }
  fs.writeFileSync(path.join(__dirname, "_extract_queue.json"), JSON.stringify(queue, null, 2));
  console.log(`complete jobs: ${completeJobs.size} | with local PDF (queued): ${queue.length}`);
})();
