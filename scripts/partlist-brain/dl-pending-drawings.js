/**
 * Backfill helper: download every job drawing that has NO cached extraction yet,
 * so a Workflow can read them and we can cache the result. One-time.
 *
 * Run: node scripts/partlist-brain/dl-pending-drawings.js
 * Out: scripts/partlist-brain/_pending/{jobId}.{ext} + _pending/manifest.json
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
  return env;
}

async function fetchAll(sb, table, cols, filter) {
  const PAGE = 1000; let off = 0; const out = [];
  for (;;) { let q = sb.from(table).select(cols).range(off, off + PAGE - 1); if (filter) q = filter(q); const { data, error } = await q; if (error) throw error; out.push(...data); if (data.length < PAGE) break; off += PAGE; }
  return out;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const jobs = await fetchAll(sb, "jobs", "id, job_number, gad_drawing_url, gad_drawing_filename", (q) => q.not("gad_drawing_url", "is", null));
  const exts = await fetchAll(sb, "job_drawing_extractions", "job_id");
  const done = new Set(exts.map((e) => e.job_id)); // any cached read => covered (generate uses the latest)
  const pending = jobs.filter((j) => !done.has(j.id));

  const dir = path.join(__dirname, "_pending");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const manifest = [];
  let ok = 0, fail = 0;
  for (const j of pending) {
    const fn = (j.gad_drawing_filename || j.gad_drawing_url || "").toLowerCase();
    const ext = /\.(pdf|png|jpe?g|webp)(\?|$)/.exec(fn)?.[1] || "pdf";
    const file = path.join(dir, `${j.id}.${ext}`);
    try {
      const res = await fetch(j.gad_drawing_url);
      if (!res.ok) { fail++; continue; }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      manifest.push({ jobId: j.id, jobNumber: j.job_number, url: j.gad_drawing_url, filename: j.gad_drawing_filename, file: file.replace(/\//g, "\\"), ext });
      ok++;
    } catch { fail++; }
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  console.log(`pending=${pending.length} downloaded=${ok} failed=${fail}`);
  console.log("manifest:", path.join(dir, "manifest.json"));
}
main().catch((e) => { console.error(e); process.exit(1); });
