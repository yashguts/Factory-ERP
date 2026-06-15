/**
 * Verifies component-demand rules (item_demand_rules) — e.g. safety frame → guide
 * shoes. Runs the SAME uncached action the app uses (no key).
 * Run: npx tsx scripts/verify-component-demand.ts
 *
 * Asserts (self-consistent against getMrpData's own frame demand):
 *  1. each guide shoe's required === Σ over rules (frame total_required × qty)
 *  2. the 4 guide shoes are make + shortfall = max(0, req − stock)
 *  3. absent from the default (flag-off) path → production plan / make-plan untouched
 *  4. flag only ADDS — every flag-off row preserved with the same required
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
const ok = (n: string, p: boolean, d = "") => { console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!p) failures++; };
const near = (a: number, b: number) => Math.abs(a - b) <= 0.001;
const SHOES = ["SA-DC-078", "SA-DC-079", "SA-DC-080", "SA-DC-081"];

(async () => {
  const withFlag = await _getMrpDataUncached(undefined, true);
  const noFlag = await _getMrpDataUncached(undefined, false);
  const byId = new Map(withFlag.map((r) => [r.item_id, r]));
  const byCode = new Map(withFlag.map((r) => [r.item_code, r]));
  const nById = new Set(noFlag.map((r) => r.item_id));

  const rules = await fetchAllRanged<{ parent_item_id: string; child_item_id: string; qty: number }>(
    (from, to, wc) => createCacheClient().from("item_demand_rules").select("parent_item_id, child_item_id, qty", wc ? { count: "exact" } : {}).range(from, to),
  );
  console.log(`rules=${rules.length}, distinct frames=${new Set(rules.map((r) => r.parent_item_id)).size}\n`);

  // expected[child_item_id] = Σ (frame demand in getMrpData × qty)
  const expected = new Map<string, number>();
  for (const r of rules) {
    const fd = byId.get(r.parent_item_id)?.total_required ?? 0;
    expected.set(r.child_item_id, (expected.get(r.child_item_id) ?? 0) + fd * (Number(r.qty) || 0));
  }

  console.log("[1] each guide shoe required === Σ frame demand × qty");
  for (const code of SHOES) {
    const row = byCode.get(code);
    const exp = row ? expected.get(row.item_id) ?? 0 : 0;
    console.log(`  ${code}: getMrpData=${row?.total_required ?? "(absent)"} expected=${exp} stock=${row?.total_stock ?? "-"} short=${row?.shortfall ?? "-"} proc=${row?.procurement_type ?? "-"}`);
    if (exp > 0) {
      ok(`${code} present`, !!row);
      if (row) {
        ok(`${code} required === Σ frame×qty`, near(row.total_required, exp), `${row.total_required} vs ${exp}`);
        ok(`${code} is make`, row.procurement_type === "make");
        ok(`${code} shortfall === max(0, req−stock)`, near(row.shortfall, Math.max(0, row.total_required - row.total_stock)));
      }
    }
  }

  console.log("[2] Absent from the default (flag-off) path");
  for (const code of SHOES) {
    const row = byCode.get(code);
    if (row) ok(`${code} absent flag-off`, !nById.has(row.item_id));
  }

  console.log("[3] Flag only ADDS — flag-off rows preserved");
  const wById = new Map(withFlag.map((r) => [r.item_id, r]));
  let changed = 0, ex = "";
  for (const r of noFlag) {
    const w = wById.get(r.item_id);
    if (!w || !near(w.total_required, r.total_required)) { changed++; if (!ex) ex = r.item_code; }
  }
  ok("all flag-off rows preserved", changed === 0, changed ? `${changed} changed (e.g. ${ex})` : `${noFlag.length} rows`);

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e?.stack || e); process.exit(1); });
