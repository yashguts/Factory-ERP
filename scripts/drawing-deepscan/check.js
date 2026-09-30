// check.js — which jobs still lack a complete scan of their CURRENT drawing?
//
// Usage:  node check.js <id1,id2,...>    (check specific jobs)
//         node check.js --all            (every job with a drawing)
//
// Complete = rows for the job's CURRENT gad_drawing_url with schema deep_v1 AND
// rich_v2, plus ralph400_v1 when the job's structure is Factory-made. A job whose
// drawing was replaced after its last scan therefore shows as incomplete.
// Prints JSON: { total, complete, incomplete: [worklist-format rows + missing[]] }.
const fs = require("fs");
const path = require("path");
// Reads the app's own public Supabase URL + anon key from the repo's .env.local.
const envText = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8").replace(/^﻿/, "");
const envVar = (k) => ((envText.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim();
const env = { url: envVar("NEXT_PUBLIC_SUPABASE_URL"), anon: envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
const H = { apikey: env.anon, Authorization: "Bearer " + env.anon };

async function paged(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${env.url}/rest/v1/${q}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(JSON.stringify(rows));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

(async () => {
  const arg = process.argv[2] || "";
  const all = arg === "--all";
  const ids = all ? null : arg.split(",").map((s) => s.trim()).filter(Boolean);
  if (!all && !ids.length) { console.log("usage: node check.js <id1,id2,...> | --all"); process.exit(2); }

  const jobFilter = all ? "gad_drawing_url=not.is.null" : `id=in.(${ids.join(",")})`;
  const jobs = await paged(`jobs?select=id,job_number,gad_drawing_url,gad_drawing_filename,floors,drive_type,capacity,structure_included&${jobFilter}&order=id`);
  const extFilter = all ? "" : `&job_id=in.(${ids.join(",")})`;
  const exts = await paged(`job_drawing_extractions?select=job_id,drawing_url,schema_version&order=id${extFilter}`);

  const have = new Map();
  for (const e of exts) {
    const k = e.job_id + "|" + e.drawing_url;
    if (!have.has(k)) have.set(k, new Set());
    have.get(k).add(e.schema_version);
  }
  const incomplete = [];
  let complete = 0;
  for (const j of jobs) {
    if (!j.gad_drawing_url) { incomplete.push({ id: j.id, n: j.job_number, missing: ["NO DRAWING UPLOADED"] }); continue; }
    const fac = j.structure_included === "Factory-made" ? 1 : 0;
    const need = ["deep_v1", "rich_v2"].concat(fac ? ["ralph400_v1"] : []);
    const got = have.get(j.id + "|" + j.gad_drawing_url) || new Set();
    const missing = need.filter((s) => !got.has(s));
    if (missing.length === 0) { complete++; continue; }
    incomplete.push({ id: j.id, n: j.job_number, u: j.gad_drawing_url, fn: j.gad_drawing_filename,
      fl: j.floors, dr: j.drive_type, cap: j.capacity, fac, missing });
  }
  console.log(JSON.stringify({ total: jobs.length, complete, incomplete }));
})().catch((e) => { console.log("FAIL: " + e.message); process.exitCode = 1; });
