/**
 * Load the parallel-agent drawing study (scripts/_study/*.json) into the AI's
 * own understanding store, job_drawing_extractions. READ-ONLY w.r.t. ERP
 * business data — only inserts into the AI corpus table. Idempotent-ish: clears
 * prior backfill rows (schema_version='rich_v1_backfill') first.
 *   node scripts/load-study-corpus.mjs
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const dir = path.join(ROOT, "scripts", "_study");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

const rows = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
  const ex = j.extraction ?? {};
  rows.push({
    job_id: j.jobId ?? path.basename(f, ".json"),
    drawing_url: null,
    drawing_filename: null,
    extracted: ex,
    spec: {
      drive_type: ex.drive_type ?? null,
      stops: ex.stops ?? null,
      capacity: ex.capacity_passengers ?? ex.capacity_kgs ?? ex.capacity ?? null,
      door_finish: ex.door_finish ?? null,
      brand: ex.brand ?? null,
    },
    model: "agent-read-vision",
    schema_version: "rich_v1_backfill",
    discrepancies: (j.mapping?.spec_discrepancies ?? []),
  });
}

// clear prior backfill rows so re-runs don't duplicate
await fetch(`${URL}/rest/v1/job_drawing_extractions?schema_version=eq.rich_v1_backfill`, { method: "DELETE", headers: H });

let inserted = 0;
for (let i = 0; i < rows.length; i += 25) {
  const batch = rows.slice(i, i + 25);
  const r = await fetch(`${URL}/rest/v1/job_drawing_extractions`, {
    method: "POST",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(batch),
  });
  if (r.ok) inserted += batch.length;
  else console.error("batch failed", r.status, (await r.text()).slice(0, 200));
}
console.log(`study files: ${files.length}, rows built: ${rows.length}, inserted: ${inserted}`);
