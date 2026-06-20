/**
 * Insert the backfill workflow's drawing reads into job_drawing_extractions, so
 * Generate can use them. Joins the workflow results (jobId -> extracted) with the
 * download manifest (jobId -> url/filename).
 *
 * Run: node scripts/partlist-brain/cache-extractions.js <workflow-output-file.json>
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

async function main() {
  const outFile = process.argv[2];
  if (!outFile) { console.error("usage: cache-extractions.js <workflow-output.json>"); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const results = (raw.result && raw.result.results) || raw.results || [];
  const manifest = require(path.join(__dirname, "_pending", "manifest.json"));
  const byId = new Map(manifest.map((m) => [m.jobId, m]));

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  let inserted = 0, skipped = 0, missing = 0;
  for (const r of results) {
    if (!r || !r.extracted) { skipped++; continue; }
    const m = byId.get(r.jobId);
    if (!m) { missing++; continue; }
    const d = r.extracted;
    const spec = { floors: d.floors, drive_type: d.drive_type, capacity: d.capacity, door_finish: d.door_finish };
    const { error } = await sb.from("job_drawing_extractions").insert({
      job_id: r.jobId,
      drawing_url: m.url,
      drawing_filename: m.filename ?? null,
      extracted: d,
      spec,
      model: "workflow-backfill",
      schema_version: "rich_v1",
      discrepancies: [],
    });
    if (error) { console.error("insert failed for", r.jobId, error.message); skipped++; }
    else inserted++;
  }
  console.log(`inserted=${inserted} skipped=${skipped} missing=${missing} of ${results.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
