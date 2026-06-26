/**
 * Verifies the Weekly MRP plan against the global optimum. Runs the SAME pure
 * functions the live action uses (no API key). Run: npx tsx scripts/verify-weekly-mrp.ts
 *
 * Hard assertions:
 *  1. zero over-provisioning  — Σ_weeks runs === the one global optimum (aggregate + per program)
 *  2. sheets reconcile        — weekly raw sheets === global raw sheets; headline sheets === optimum
 *  3. cumulative coverage     — by every week, produced(≤w) ≥ demand(≤w); full at the last week
 *  4. demand conservation     — Σ_weeks demand === getMrpData(horizonEnd) per item
 *  5. monotonic shortfall     — cumulative non-decreasing; per-week ≥ 0
 */
import * as fs from "fs";
import * as path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].trim();
}
import { loadWeeklyDemand, _getWeeklyUncached } from "../src/lib/actions/mrp-weekly";
import { computeMakePlanCore, explodeToLeaves } from "../src/lib/actions/make-plan-core";
import { _getMrpDataUncached, type MrpRow } from "../src/lib/actions/mrp";

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) failures++;
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

(async () => {
  console.log("Loading weekly demand, plan, and the recomputed optimum core…");
  const l = await loadWeeklyDemand();
  const plan = await _getWeeklyUncached([]);
  const N = l.weeks.length;
  console.log(`horizonEnd=${l.horizonEnd}  weeks=${N}  demandedItems=${l.demandByItemWeek.size}  later=${l.laterCount} undated=${l.undatedCount}`);
  console.log(`plan: make=${plan.make.length} trade=${plan.trade.length} programs=${plan.programs.length} buy=${plan.buy.length} blocked=${plan.blocked.length}`);
  console.log(`totals: globalRuns=${plan.totals.globalRuns} allocatedRuns=${plan.totals.allocatedRuns} globalSheets=${plan.totals.globalSheets}\n`);

  // Recompute the optimum core from the same demand the action saw.
  const mrpRows: MrpRow[] = [...l.itemMeta].map(([id, m]) => {
    const total = l.demandByItemWeek.get(id)!.reduce((s, x) => s + x, 0);
    return { item_id: id, item_code: m.code, item_name: m.name, item_type: m.item_type, category_name: m.category_name, uom_abbreviation: m.uom, total_required: total, total_stock: m.stock, shortfall: Math.max(0, total - m.stock), job_count: 0, procurement_type: m.procurement_type };
  });
  const core = await computeMakePlanCore([], mrpRows);
  const coreRuns = [...core.runs.values()].reduce((s, r) => s + r, 0);

  // ── 1. zero over-provisioning ──────────────────────────────────────────────
  console.log("[1] Zero over-provisioning");
  ok("allocatedRuns === globalRuns", plan.totals.allocatedRuns === plan.totals.globalRuns, `${plan.totals.allocatedRuns} vs ${plan.totals.globalRuns}`);
  ok("globalRuns === recomputed core runs", plan.totals.globalRuns === coreRuns, `${plan.totals.globalRuns} vs ${coreRuns}`);
  const planByOp = new Map(plan.programs.map((p) => [p.program_id, p]));
  let perOpOk = true; let perOpDetail = "";
  for (const [op, runs] of core.runs) {
    const row = planByOp.get(op);
    const got = row ? row.totalRuns : 0;
    if (got !== runs) { perOpOk = false; perOpDetail = `${core.ops.get(op)?.code ?? op}: alloc ${got} ≠ optimum ${runs}`; break; }
  }
  ok("per-program Σ(weekly runs) === optimum runs[op]", perOpOk, perOpDetail);
  let sumWeekOk = true;
  for (const p of plan.programs) if (p.runsPerWeek.reduce((s, x) => s + x, 0) !== p.totalRuns) sumWeekOk = false;
  ok("each program runsPerWeek sums to totalRuns", sumWeekOk);

  // ── 2. sheets reconcile ────────────────────────────────────────────────────
  console.log("[2] Sheets reconcile");
  ok("headline globalSheets === optimum core sheets", plan.totals.globalSheets === core.runsSheets, `${plan.totals.globalSheets} vs ${core.runsSheets}`);
  let rawInputSheets = 0;
  for (const [op, runs] of core.runs) for (const [, perRun] of core.inputsOf.get(op) ?? []) rawInputSheets += perRun * runs;
  const weeklySheetSum = plan.buy.reduce((s, r) => s + r.perWeek.reduce((a, b) => a + b, 0), 0);
  ok("Σ weekly buy sheets === Σ optimum sheet inputs (raw)", near(weeklySheetSum, rawInputSheets), `${weeklySheetSum.toFixed(2)} vs ${rawInputSheets.toFixed(2)}`);

  // ── 3. cumulative coverage ─────────────────────────────────────────────────
  console.log("[3] Cumulative coverage");
  const isMakeLeaf = (id: string) => {
    const it = core.itemInfo.get(id) ?? {};
    const proc = it.procurement_type ?? (it.category_id ? core.catProc.get(it.category_id)?.procurement_type : null) ?? null;
    return proc !== "trade";
  };
  // leafCumDemand[leaf][i] (replicates the action)
  const makeableCum = (f: string): number[] => {
    const dem = l.demandByItemWeek.get(f) ?? new Array(N).fill(0);
    const out: number[] = []; let cg = 0;
    for (let i = 0; i < N; i++) { cg += dem[i]; out.push(Math.max(0, cg - (core.stock.get(f) ?? 0))); }
    return out;
  };
  const mc = new Map(core.makeable.map((f) => [f, makeableCum(f)]));
  const leafCumDemand = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const fin = new Map<string, number>();
    for (const f of core.makeable) { const cs = mc.get(f)![i]; if (cs > 0) fin.set(f, cs); }
    for (const [leaf, q] of explodeToLeaves(fin, core.topo, core.partsOf, core.stock, (id) => isMakeLeaf(id) && core.aud.has(id), isMakeLeaf)) {
      const arr = leafCumDemand.get(leaf) ?? new Array(N).fill(0); arr[i] = q; leafCumDemand.set(leaf, arr);
    }
  }
  // producedCum[leaf][i] from the plan's per-week allocation
  const producedCum = new Map<string, number[]>();
  for (const p of plan.programs) {
    for (const [part, perRun] of core.fullOut.get(p.program_id) ?? []) {
      const arr = producedCum.get(part) ?? new Array(N).fill(0);
      let run = 0;
      for (let i = 0; i < N; i++) { run += p.runsPerWeek[i] * perRun; arr[i] += run; }
      producedCum.set(part, arr);
    }
  }
  let coverViolations = 0; let coverEx = "";
  for (const [leaf, demArr] of leafCumDemand) {
    const prod = producedCum.get(leaf) ?? new Array(N).fill(0);
    for (let i = 0; i < N; i++) if (prod[i] < demArr[i] - 1e-6) { coverViolations++; if (!coverEx) coverEx = `${core.itemInfo.get(leaf)?.code ?? leaf} wk${l.weeks[i].index}: produced ${prod[i]} < demand ${demArr[i]}`; break; }
  }
  ok("every leaf covered at every week", coverViolations === 0, coverViolations ? `${coverViolations} leaves under-covered (e.g. ${coverEx})` : "");
  let lastOk = true; let lastEx = "";
  for (const [leaf, need] of core.leafProduce) {
    const prod = (producedCum.get(leaf) ?? [])[N - 1] ?? 0;
    if (prod < need - 1e-6) { lastOk = false; lastEx = `${core.itemInfo.get(leaf)?.code ?? leaf}: ${prod} < ${need}`; break; }
  }
  ok("full leafProduce met by the last week", lastOk, lastEx);

  // ── 4. demand conservation ─────────────────────────────────────────────────
  console.log("[4] Demand conservation vs getMrpData(horizonEnd)");
  const mrp = await _getMrpDataUncached(l.horizonEnd);
  const mrpReq = new Map(mrp.map((r) => [r.item_id, r.total_required]));
  let consViolations = 0; let consEx = "";
  for (const [id, dem] of l.demandByItemWeek) {
    const sum = dem.reduce((s, x) => s + x, 0);
    const canon = mrpReq.get(id) ?? 0;
    if (!near(sum, canon)) { consViolations++; if (!consEx) consEx = `${l.itemMeta.get(id)?.code ?? id}: weekly Σ ${sum} ≠ getMrpData ${canon}`; }
  }
  ok("Σ weekly demand === getMrpData total_required (per item)", consViolations === 0, consViolations ? `${consViolations} mismatches (e.g. ${consEx})` : `${l.demandByItemWeek.size} items match`);

  // ── 5. monotonic shortfall ─────────────────────────────────────────────────
  console.log("[5] Monotonic cumulative shortfall");
  let monoOk = true; let monoEx = "";
  for (const row of [...plan.make, ...plan.trade]) {
    for (let i = 1; i < N; i++) if (row.cumulative[i] < row.cumulative[i - 1] - 1e-9) { monoOk = false; monoEx = `${row.code}`; }
    for (let i = 0; i < N; i++) if (row.perWeek[i] < -1e-9) { monoOk = false; monoEx = `${row.code} (neg perWeek)`; }
  }
  ok("cumulative non-decreasing & perWeek ≥ 0", monoOk, monoEx);

  // payload size (2MB cache cap)
  const bytes = Buffer.byteLength(JSON.stringify(plan));
  console.log(`\npayload: ${(bytes / 1024).toFixed(0)} KB ${bytes > 1.5 * 1024 * 1024 ? "⚠ approaching the 2MB unstable_cache cap" : "(ok)"}`);

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e?.stack || e); process.exit(1); });
