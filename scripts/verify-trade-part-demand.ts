/**
 * Verifies the "trade parts under made items" demand surfacing (DS-002 / DS-003
 * collapsible door shoes). Runs the SAME uncached action the app uses (no key).
 * Run: npx tsx scripts/verify-trade-part-demand.ts
 *
 * Hard assertions:
 *  1. DS-002 required === 15 × Σ(in-scope demand for gates 10+1..24+1)   (self-consistent w/ the gate rows in the same plan)
 *  2. DS-003 required === 7  × Σ(in-scope demand for gates 6+1..9+1)
 *  3. both shoes are TRADE (land in the Trade tab) + shortfall === max(0, req − stock)
 *  4. regression: the ONLY rows that aren't on a job BOM directly are DS-002/DS-003 — nothing else got spuriously derived
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

const DS002_GATES = [
  "DP-CD-CD-006", "DP-CD-CD-007", "DP-CD-CD-008", "DP-CD-CD-009", "DP-CD-CD-010",
  "DP-CD-CD-011", "DP-CD-CD-012", "DP-CD-CD-013", "DP-CD-CD-014", "DP-CD-CD-015",
  "DP-CD-CD-016", "DP-CD-CD-017", "DP-CD-CD-018", "DP-CD-CD-019", "DP-CD-CD-020",
  "DP-CD-CD-021", "DP-CD-CD-025",
];
const DS003_GATES = ["DP-CD-CD-002", "DP-CD-CD-003", "DP-CD-CD-004", "DP-CD-CD-005"];

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) failures++;
};
const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps;

(async () => {
  const rows = await _getMrpDataUncached(undefined, true); // includeDerivedTrade, no cutoff
  const byCode = new Map(rows.map((r) => [r.item_code, r]));
  const ds002 = byCode.get("DS-002");
  const ds003 = byCode.get("DS-003");

  const sumGates = (codes: string[]) =>
    codes.reduce((s, c) => s + (byCode.get(c)?.total_required ?? 0), 0);
  const g002 = sumGates(DS002_GATES);
  const g003 = sumGates(DS003_GATES);

  console.log("Contributing gate demand (net, in MRP scope):");
  for (const c of [...DS002_GATES, ...DS003_GATES]) {
    const r = byCode.get(c);
    if (r && r.total_required > 0) console.log(`  ${c}  ${r.item_name}  req=${r.total_required}`);
  }
  console.log(`\nΣ gates 10+1..24+1 = ${g002}  → DS-002 expected ${15 * g002}`);
  console.log(`Σ gates 6+1..9+1   = ${g003}  → DS-003 expected ${7 * g003}`);
  console.log(`DS-002: ${ds002 ? `req=${ds002.total_required} stock=${ds002.total_stock} short=${ds002.shortfall} proc=${ds002.procurement_type}` : "(absent)"}`);
  console.log(`DS-003: ${ds003 ? `req=${ds003.total_required} stock=${ds003.total_stock} short=${ds003.shortfall} proc=${ds003.procurement_type}` : "(absent)"}\n`);

  console.log("[1] DS-002 (C.I) demand = 15 × in-scope gate demand");
  ok("DS-002 present", !!ds002);
  if (ds002) {
    ok("DS-002 required === 15 × Σ gates", near(ds002.total_required, 15 * g002), `${ds002.total_required} vs ${15 * g002}`);
    ok("DS-002 is trade", ds002.procurement_type === "trade");
    ok("DS-002 shortfall === max(0, req − stock)", near(ds002.shortfall, Math.max(0, ds002.total_required - ds002.total_stock)));
  }

  console.log("[2] DS-003 (PVC) demand = 7 × in-scope gate demand");
  ok("DS-003 present", !!ds003);
  if (ds003) {
    ok("DS-003 required === 7 × Σ gates", near(ds003.total_required, 7 * g003), `${ds003.total_required} vs ${7 * g003}`);
    ok("DS-003 is trade", ds003.procurement_type === "trade");
    ok("DS-003 shortfall === max(0, req − stock)", near(ds003.shortfall, Math.max(0, ds003.total_required - ds003.total_stock)));
  }

  console.log("[3] Regression: nothing else got spuriously derived");
  // Superset of every item that sits on a job BOM directly (any job). A row in
  // the plan whose item is NOT in this set must be a derived trade leaf — and the
  // only ones we introduced are DS-002 / DS-003.
  const directRows = await fetchAllRanged<{ item_id: string }>((from, to, withCount) =>
    createCacheClient()
      .from("job_bom_lines")
      .select("item_id", withCount ? { count: "exact" } : {})
      .not("item_id", "is", null)
      .range(from, to),
  );
  const directSet = new Set(directRows.map((r) => r.item_id));
  const unexpected = rows.filter((r) => !directSet.has(r.item_id) && r.item_code !== "DS-002" && r.item_code !== "DS-003");
  ok("only DS-002/DS-003 are purely-derived (not on any job BOM)", unexpected.length === 0,
    unexpected.length ? `unexpected: ${unexpected.slice(0, 5).map((r) => r.item_code).join(", ")}` : "");
  ok("DS-002 is purely derived (not on a job BOM)", !ds002 || !directSet.has(ds002.item_id));
  ok("DS-003 is purely derived (not on a job BOM)", !ds003 || !directSet.has(ds003.item_id));

  console.log("[4] Default (opt-out) path stays DIRECT-only — no double-count downstream");
  // getProductionPlan + the locked make-plan call _getMrpDataUncached WITHOUT the
  // flag and explode the gates themselves; the shoes must NOT also appear as
  // top-level demand there, or the purchased list would count them twice.
  const direct = await _getMrpDataUncached(undefined, false);
  const dCodes = new Set(direct.map((r) => r.item_code));
  ok("DS-002 absent from direct demand (flag off)", !dCodes.has("DS-002"));
  ok("DS-003 absent from direct demand (flag off)", !dCodes.has("DS-003"));
  ok("gates still present in direct demand (they explode to the shoes in the plan)",
    [...DS002_GATES, ...DS003_GATES].some((c) => dCodes.has(c)));

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e?.stack || e); process.exit(1); });
