/**
 * Verifies the job-attribute (drive_type) demand rules — Home/Belt lifts need
 * 4x GS-002 + 4x GS-005. Runs the SAME uncached action the app uses (no key).
 * Run: npx tsx scripts/verify-job-drive-demand.ts
 *
 * Asserts:
 *  1. GS-002/GS-005 required === 4 × (in-production Home/Belt jobs); job_count matches; trade; shortfall = max(0, req−stock)
 *  2. they are ABSENT from the default (flag-off) path — so getProductionPlan / the locked make-plan never see them
 *  3. the flag only ADDS: every flag-off row is unchanged with the flag on
 */
import * as fs from "fs";
import * as path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].trim();
}
import { _getMrpDataUncached } from "../src/lib/actions/mrp";
import { createCacheClient } from "../src/lib/supabase/cache-client";
import { fetchAllRanged } from "../src/lib/supabase/fetch-all";

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) failures++;
};

(async () => {
  // independent count of in-production Home/Belt jobs (no cutoff)
  const hb = await fetchAllRanged<{ id: string }>((from, to, wc) =>
    createCacheClient().from("jobs").select("id", wc ? { count: "exact" } : {})
      .eq("status", "in_production").in("drive_type", ["HOME", "BELT"]).range(from, to),
  );
  const hbCount = hb.length;
  const expected = 4 * hbCount;
  console.log(`In-production Home/Belt jobs = ${hbCount}  → each GS expected required = ${expected}\n`);

  const withFlag = await _getMrpDataUncached(undefined, true);
  const noFlag = await _getMrpDataUncached(undefined, false);
  const wBy = new Map(withFlag.map((r) => [r.item_code, r]));
  const nBy = new Map(noFlag.map((r) => [r.item_code, r]));

  console.log("[1] GS-002 / GS-005 demand = 4 × Home/Belt lifts");
  for (const code of ["GS-002", "GS-005"]) {
    const r = wBy.get(code);
    ok(`${code} present (flag on)`, !!r);
    if (r) {
      ok(`${code} required === 4 × Home/Belt`, r.total_required === expected, `${r.total_required} vs ${expected}`);
      ok(`${code} job_count === Home/Belt count`, r.job_count === hbCount, `${r.job_count} vs ${hbCount}`);
      ok(`${code} is trade`, r.procurement_type === "trade");
      ok(`${code} shortfall === max(0, req − stock)`, r.shortfall === Math.max(0, r.total_required - r.total_stock));
    }
  }

  console.log("[2] Absent from the default (flag-off) path — optimiser/plan never see them");
  ok("GS-002 absent (flag off)", !nBy.has("GS-002"));
  ok("GS-005 absent (flag off)", !nBy.has("GS-005"));

  console.log("[3] Flag only ADDS — every flag-off row is unchanged with the flag on");
  let changed = 0; let ex = "";
  for (const [code, n] of nBy) {
    const w = wBy.get(code);
    if (!w || w.total_required !== n.total_required) { changed++; if (!ex) ex = code; }
  }
  ok("all flag-off rows preserved with same required", changed === 0, changed ? `${changed} changed (e.g. ${ex})` : `${nBy.size} rows`);

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e?.stack || e); process.exit(1); });
