// post.js — validate one job's scan and write it to job_drawing_extractions.
//
// Usage:  node post.js <path-to-job-file.json> [--dry]
//
// The job file is written by the scanning agent:
//   { "job_id": "<uuid>", "drawing_url": "<url scanned>", "drawing_filename": "<fn>",
//     "extracted": { ...full deep_v1 record: rich top-level fields + dimensions +
//                    additional_details + notes + deep{18 sections} },
//     "ralph": { ...ralph400_v1 record } | null }
//
// This script (not the agent) decides everything mechanical:
//   * refuses if the job's CURRENT drawing differs from the one scanned
//     (drawing replaced mid-run -> re-download + re-scan),
//   * validates structure/enums and coerces harmless type slips,
//   * computes spec + discrepancies vs the ERP-entered values,
//   * derives the rich_v2 copy from the deep record (no retyping),
//   * skips any schema already stored for this job+drawing (idempotent),
//   * inserts ralph400_v1 -> deep_v1 -> rich_v2 so the NEWEST row is always
//     the rich-shaped one the app's "latest extraction" readers expect.
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
// Reads the app's own public Supabase URL + anon key from the repo's .env.local.
const envText = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8").replace(/^﻿/, "");
const envVar = (k) => ((envText.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim();
const env = { url: envVar("NEXT_PUBLIC_SUPABASE_URL"), anon: envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
const H = { apikey: env.anon, Authorization: "Bearer " + env.anon, "Content-Type": "application/json" };
// Model label stamped on rows; rows with this label count as "already written by this run".
const MODEL = process.env.DEEPSCAN_MODEL || "claude-opus-5-5";

const RICH_FIELDS = ["drive_type", "floors", "capacity", "door_type", "door_finish", "landing_door_finish",
  "door_vision", "door_side", "brand", "machine_room", "counterweight_position"];
const DIM_KEYS = ["shaft_width_mm", "shaft_depth_mm", "car_width_mm", "car_depth_mm", "car_height_mm",
  "door_opening_width_mm", "door_opening_height_mm", "pit_depth_mm", "overhead_mm", "travel_mm", "speed_mps",
  "car_rail_to_wall_mm", "counter_rail_to_wall_mm", "bracket_spacing_mm", "dbg_main_mm", "dbg_counter_mm"];
const DEEP_KEYS = ["customer", "title_block", "spec_table", "lift_shaft", "landings", "car", "doors", "rails",
  "counterweight", "machine_drive", "pit_items", "electrical", "by_owner_scope", "text_notes",
  "all_dimensions", "page_inventory", "anomalies", "not_visible"];
const RALPH_KEYS = ["stops", "floor_to_floor_mm", "pit_mm", "overhead_mm", "structure_width_mm",
  "structure_depth_mm", "cwt_side", "door_type", "door_opening_width_mm", "door_hand", "notes"];
const DRIVES = ["MR", "MRL", "HOME", "BELT", "MRLBELT", "HYD", "CANTI", "R1000", null];
const CONFS = ["high", "medium", "low"];

const errors = [];
const warns = [];
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function checkField(obj, key, where, allowed) {
  const f = obj[key];
  if (!isObj(f) || !("value" in f)) { errors.push(`${where}.${key} must be {value, confidence, rationale}`); return; }
  if (!CONFS.includes(f.confidence)) errors.push(`${where}.${key}.confidence must be high|medium|low (got ${JSON.stringify(f.confidence)})`);
  if (typeof f.rationale !== "string") f.rationale = f.rationale == null ? "" : String(f.rationale);
  if (allowed && !allowed.includes(f.value)) errors.push(`${where}.${key}.value must be one of ${JSON.stringify(allowed)} (got ${JSON.stringify(f.value)})`);
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function validateExtracted(x) {
  if (!isObj(x)) { errors.push("extracted must be an object"); return; }
  for (const k of RICH_FIELDS) checkField(x, k, "extracted", k === "drive_type" ? DRIVES : null);
  if (isObj(x.floors)) {
    const n = toInt(x.floors.value);
    if (Number.isNaN(n) || (n !== null && (n < 1 || n > 60))) errors.push(`extracted.floors.value must be an integer stop count or null (got ${JSON.stringify(x.floors.value)})`);
    else x.floors.value = n;
  }
  if (!isObj(x.dimensions)) errors.push("extracted.dimensions must be an object");
  else {
    for (const k of DIM_KEYS) {
      const d = x.dimensions[k];
      if (!isObj(d) || !("value" in d)) { errors.push(`extracted.dimensions.${k} missing — must be {value: string|null, confidence}`); continue; }
      if (d.value !== null && typeof d.value !== "string") d.value = String(d.value);
      if (!CONFS.includes(d.confidence)) errors.push(`extracted.dimensions.${k}.confidence invalid`);
    }
    const extra = Object.keys(x.dimensions).filter((k) => !DIM_KEYS.includes(k));
    if (extra.length) warns.push(`extra dimension keys kept: ${extra.join(", ")}`);
  }
  if (!Array.isArray(x.additional_details)) errors.push("extracted.additional_details must be an array");
  if (typeof x.notes !== "string" || x.notes.length < 40) errors.push("extracted.notes must be a thorough paragraph");
  if (!isObj(x.deep)) errors.push("extracted.deep must be an object with the 18 sections");
  else {
    const missing = DEEP_KEYS.filter((k) => !(k in x.deep));
    if (missing.length) errors.push(`extracted.deep missing sections: ${missing.join(", ")}`);
    if (!Array.isArray(x.deep.all_dimensions)) errors.push("extracted.deep.all_dimensions must be an array");
    else if (x.deep.all_dimensions.length < 10) warns.push(`only ${x.deep.all_dimensions.length} dimensions captured — fine ONLY if the drawing is genuinely sparse (say so in deep.anomalies)`);
    if (!Array.isArray(x.deep.page_inventory) || x.deep.page_inventory.length === 0) errors.push("extracted.deep.page_inventory must list every page read");
  }
  x.schema = "deep_v1";
}

function validateRalph(r) {
  if (!isObj(r)) { errors.push("ralph must be an object for a factory-structure job"); return; }
  const missing = RALPH_KEYS.filter((k) => !(k in r));
  if (missing.length) { errors.push(`ralph missing keys: ${missing.join(", ")}`); return; }
  checkField(r, "stops", "ralph");
  for (const k of ["pit_mm", "overhead_mm", "structure_width_mm", "structure_depth_mm", "door_opening_width_mm"]) {
    checkField(r, k, "ralph");
    if (isObj(r[k])) {
      const n = toInt(r[k].value);
      if (Number.isNaN(n)) errors.push(`ralph.${k}.value must be an integer mm or null`);
      else r[k].value = n;
    }
  }
  if (isObj(r.stops)) {
    const n = toInt(r.stops.value);
    if (Number.isNaN(n)) errors.push("ralph.stops.value must be an integer or null");
    else r.stops.value = n;
  }
  checkField(r, "cwt_side", "ralph", ["BACK", "LEFT", "RIGHT", null]);
  checkField(r, "door_type", "ralph", ["AT", "ACO", "SWING", "MCD", null]);
  checkField(r, "door_hand", "ralph", ["L", "R", null]);
  if (!Array.isArray(r.floor_to_floor_mm)) errors.push("ralph.floor_to_floor_mm must be an array (bottom-up)");
  else r.floor_to_floor_mm.forEach((e, i) => {
    const n = toInt(e && e.mm);
    if (!isObj(e) || n === null || Number.isNaN(n)) errors.push(`ralph.floor_to_floor_mm[${i}] must be {mm:int, confidence, label}`);
    else { e.mm = n; if (!CONFS.includes(e.confidence)) errors.push(`ralph.floor_to_floor_mm[${i}].confidence invalid`); if (typeof e.label !== "string") e.label = String(e.label ?? ""); }
  });
  if (typeof r.notes !== "string") r.notes = r.notes == null ? "" : String(r.notes);
}

async function main() {
  const file = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!file) { console.log("usage: node post.js <job-file.json> [--dry]"); process.exit(2); }
  const body = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""));
  const { job_id, drawing_url } = body;
  if (!job_id || !drawing_url) { console.log("FAIL: job file needs job_id and drawing_url"); process.exitCode = 1; return; }

  const jr = await fetch(`${env.url}/rest/v1/jobs?id=eq.${job_id}&select=job_number,gad_drawing_url,gad_drawing_filename,structure_included,floors,drive_type,capacity`, { headers: H });
  const [job] = await jr.json();
  if (!job) { console.log(`FAIL: job ${job_id} not found`); process.exitCode = 1; return; }
  if (job.gad_drawing_url !== drawing_url) {
    console.log(`FAIL DRAWING CHANGED: ${job.job_number}'s current drawing is now ${job.gad_drawing_url} — download THAT url, re-scan it, set drawing_url/drawing_filename to it, and run post.js again.`);
    process.exitCode = 1; return;
  }
  const fac = job.structure_included === "Factory-made";

  validateExtracted(body.extracted);
  if (fac) validateRalph(body.ralph);
  if (errors.length) {
    console.log(`FAIL VALIDATION (${job.job_number}) — fix the job file and re-run:\n - ` + errors.join("\n - "));
    if (warns.length) console.log("warnings:\n - " + warns.join("\n - "));
    process.exitCode = 1; return;
  }

  const x = body.extracted;
  const spec = {};
  for (const k of ["floors", "drive_type", "capacity", "door_type", "door_finish", "landing_door_finish", "door_vision", "door_side", "brand"]) spec[k] = x[k];
  const discrepancies = [];
  const cmp = (field, d, e) => {
    if (d == null || e == null) return;
    if (String(d).trim() && String(d) !== String(e)) discrepancies.push({ field, drawing: String(d), entered: String(e), note: "drawing differs from entered value" });
  };
  cmp("drive_type", x.drive_type.value, job.drive_type);
  cmp("floors", x.floors.value, job.floors);
  cmp("capacity", x.capacity.value, job.capacity);

  const rich = JSON.parse(JSON.stringify(x));
  delete rich.deep;
  delete rich.schema;

  const base = { job_id, drawing_url, drawing_filename: body.drawing_filename ?? job.gad_drawing_filename ?? null, model: MODEL };
  const rows = [];
  if (fac) rows.push({ ...base, schema_version: "ralph400_v1", extracted: body.ralph, spec: {}, discrepancies: [] });
  rows.push({ ...base, schema_version: "deep_v1", extracted: x, spec, discrepancies });
  rows.push({ ...base, schema_version: "rich_v2", extracted: rich, spec, discrepancies });

  const er = await fetch(`${env.url}/rest/v1/job_drawing_extractions?job_id=eq.${job_id}&select=schema_version,drawing_url,model`, { headers: H });
  const have = new Set((await er.json()).filter((r) => r.drawing_url === drawing_url && r.model === MODEL).map((r) => r.schema_version));

  const wrote = [], skipped = [];
  for (const row of rows) {
    if (have.has(row.schema_version)) { skipped.push(row.schema_version); continue; }
    if (dry) { wrote.push(row.schema_version + "(dry)"); continue; }
    const r = await fetch(`${env.url}/rest/v1/job_drawing_extractions`, {
      method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(row),
    });
    if (r.status !== 201) { console.log(`FAIL INSERT ${row.schema_version} (${job.job_number}) HTTP ${r.status}: ${await r.text()}`); process.exitCode = 1; return; }
    wrote.push(row.schema_version);
    await new Promise((res) => setTimeout(res, 60)); // strictly increasing extracted_at
  }
  console.log(`OK ${job.job_number}: wrote [${wrote.join(", ")}] skipped [${skipped.join(", ")}] — ${x.deep.all_dimensions.length} dimensions, ${x.deep.page_inventory.length} page(s), ${discrepancies.length} discrepancy(ies)${fac ? ", factory structure" : ""}`);
  if (warns.length) console.log("warnings:\n - " + warns.join("\n - "));
}

main().catch((e) => { console.log("FAIL: " + (e && e.message ? e.message : e)); process.exitCode = 1; return; });
