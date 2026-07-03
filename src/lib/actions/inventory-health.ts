"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

/* ------------------------------------------------------------------ *
 * Inventory Health — a read-only reconciliation / control panel.
 *
 * Surfaces the integrity gaps that make on-hand untrustworthy today:
 *  - per-warehouse balances + how many items are negative,
 *  - NEGATIVE stock (the clearest "something's off" signal),
 *  - MISPLACED raw sheets: raw_material stock sitting OUTSIDE the Raw Material
 *    Store (PO receipts route everything to Main Store, but program runs consume
 *    sheets FROM Raw Material Store — so received sheets never net down),
 *  - UNPOSTED events: dispatches / program runs that have no matching stock
 *    transaction (the forward-only backfill hole — best-effort posting that
 *    silently never ran, plus all the pre-feature history).
 *
 * Pure read. No mutations. The fixes (warehouse routing, atomic posting,
 * stock-take baseline) land separately on a feature branch.
 * ------------------------------------------------------------------ */

const RAW_STORE = "Raw Material Store";

export interface WarehouseHealth {
  name: string;
  items_with_stock: number;
  items_negative: number;
  total_qty: number;
}
export interface NegativeRow {
  item_id: string;
  code: string;
  name: string;
  warehouse: string;
  qty: number;
}
export type MisplacedRow = NegativeRow;
export interface UnpostedDispatch {
  id: string;
  job_number: string;
  dispatch_date: string;
}
export interface UnpostedRun {
  id: string;
  code: string | null;
  name: string;
  run_date: string;
}
export interface InventoryHealth {
  warehouses: WarehouseHealth[];
  totalNegative: number;
  negatives: NegativeRow[];
  misplacedSheets: { count: number; qty: number; sample: MisplacedRow[] };
  unpostedDispatches: { count: number; sample: UnpostedDispatch[] };
  unpostedRuns: { count: number; sample: UnpostedRun[] };
}

async function _getInventoryHealthUncached(): Promise<InventoryHealth> {
  const supabase = createCacheClient();

  // Seven independent scans — none reads another's result, so fetch them all
  // concurrently (serially they were the whole cold-path wall-clock).
  const [whsRes, inv, rawIds, dispatches, dispTxn, runs, runTxn] = await Promise.all([
    // Warehouses.
    supabase.from("warehouses").select("id, name"),
    // All balance rows (paged — ~2k+ rows, over the 1000 cap).
    fetchAllRanged<{ item_id: string; warehouse_id: string; quantity: number }>(
      (from, to, wc) =>
        supabase
          .from("inventory")
          .select("item_id, warehouse_id, quantity", wc ? { count: "exact" } : {})
          .range(from, to),
    ),
    // Raw-material item ids (for the misplaced-sheets check).
    fetchAllRanged<{ id: string }>(
      (from, to, wc) =>
        supabase
          .from("items")
          .select("id", wc ? { count: "exact" } : {})
          .eq("item_type", "raw_material")
          .range(from, to),
    ),
    // All dispatches + their posted 'dispatch' txns (unposted = no match).
    fetchAllRanged<{ id: string; job_id: string; dispatch_date: string }>(
      (from, to, wc) =>
        supabase
          .from("job_dispatches")
          .select("id, job_id, dispatch_date", wc ? { count: "exact" } : {})
          .range(from, to),
    ),
    fetchAllRanged<{ reference_id: string }>(
      (from, to, wc) =>
        supabase
          .from("inventory_transactions")
          .select("reference_id", wc ? { count: "exact" } : {})
          .eq("reference_type", "dispatch")
          .not("reference_id", "is", null)
          .range(from, to),
    ),
    // All program runs + their posted 'program_run' txns.
    fetchAllRanged<{ id: string; operation_id: string; run_date: string }>(
      (from, to, wc) =>
        supabase
          .from("operation_runs")
          .select("id, operation_id, run_date", wc ? { count: "exact" } : {})
          .range(from, to),
    ),
    fetchAllRanged<{ reference_id: string }>(
      (from, to, wc) =>
        supabase
          .from("inventory_transactions")
          .select("reference_id", wc ? { count: "exact" } : {})
          .eq("reference_type", "program_run")
          .not("reference_id", "is", null)
          .range(from, to),
    ),
  ]);
  const whs = whsRes.data;
  const whName = new Map((whs ?? []).map((w: any) => [w.id as string, w.name as string]));
  const rawStoreId = (whs ?? []).find((w: any) => w.name === RAW_STORE)?.id as string | undefined;

  // Per-warehouse summary.
  const whAgg = new Map<string, { items_with_stock: number; items_negative: number; total_qty: number }>();
  for (const r of inv) {
    const q = Number(r.quantity) || 0;
    const a = whAgg.get(r.warehouse_id) ?? { items_with_stock: 0, items_negative: 0, total_qty: 0 };
    if (q !== 0) a.items_with_stock += 1;
    if (q < 0) a.items_negative += 1;
    a.total_qty += q;
    whAgg.set(r.warehouse_id, a);
  }
  const warehouses = [...whAgg.entries()]
    .map(([id, a]) => ({ name: whName.get(id) ?? "—", ...a }))
    .sort((a, b) => b.total_qty - a.total_qty);

  // Negative balances (most-negative first) + raw-material id set (for misplaced).
  const negRows = inv
    .filter((r) => Number(r.quantity) < 0)
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));
  const totalNegative = negRows.length;
  const negTop = negRows.slice(0, 100);

  const rawSet = new Set(rawIds.map((r) => r.id));
  const misplacedAll = inv.filter(
    (r) => Number(r.quantity) > 0 && r.warehouse_id !== rawStoreId && rawSet.has(r.item_id),
  );
  const misplacedSample = misplacedAll
    .sort((a, b) => Number(b.quantity) - Number(a.quantity))
    .slice(0, 25);

  // Unposted dispatches: a dispatch with no reference_type='dispatch' txn.
  const postedDisp = new Set(dispTxn.map((t) => t.reference_id));
  const unpostedDispRows = dispatches.filter((d) => !postedDisp.has(d.id));
  const dispJobIds = [...new Set(unpostedDispRows.slice(0, 25).map((d) => d.job_id))];

  // Unposted program runs: a run with no reference_type='program_run' txn.
  const postedRun = new Set(runTxn.map((t) => t.reference_id));
  const unpostedRunRows = runs.filter((r) => !postedRun.has(r.id));
  const runOpIds = [...new Set(unpostedRunRows.slice(0, 25).map((r) => r.operation_id))];

  // Names/codes only for what we display — three small keyed lookups, mutually
  // independent, so they share one concurrent wave.
  const nameIds = [...new Set([...negTop.map((r) => r.item_id), ...misplacedSample.map((r) => r.item_id)])];
  const itemInfo = new Map<string, { code: string; name: string }>();
  const jobNum = new Map<string, string>();
  const opInfo = new Map<string, { code: string | null; name: string }>();
  const nameChunks: string[][] = [];
  for (let i = 0; i < nameIds.length; i += 300) nameChunks.push(nameIds.slice(i, i + 300));
  await Promise.all([
    ...nameChunks.map(async (chunk) => {
      const { data } = await supabase.from("items").select("id, code, name").in("id", chunk);
      for (const it of data ?? [])
        itemInfo.set(it.id as string, { code: it.code as string, name: it.name as string });
    }),
    (async () => {
      if (!dispJobIds.length) return;
      const { data } = await supabase.from("jobs").select("id, job_number").in("id", dispJobIds);
      for (const j of data ?? []) jobNum.set(j.id as string, j.job_number as string);
    })(),
    (async () => {
      if (!runOpIds.length) return;
      const { data } = await supabase.from("operations").select("id, code, name").in("id", runOpIds);
      for (const o of data ?? [])
        opInfo.set(o.id as string, { code: (o.code as string | null) ?? null, name: o.name as string });
    })(),
  ]);

  const row = (r: { item_id: string; warehouse_id: string; quantity: number }): NegativeRow => {
    const it = itemInfo.get(r.item_id);
    return {
      item_id: r.item_id,
      code: it?.code ?? "—",
      name: it?.name ?? "—",
      warehouse: whName.get(r.warehouse_id) ?? "—",
      qty: Number(r.quantity),
    };
  };
  const negatives = negTop.map(row);
  const misplacedSheets = {
    count: misplacedAll.length,
    qty: misplacedAll.reduce((s, r) => s + Number(r.quantity), 0),
    sample: misplacedSample.map(row),
  };
  const unpostedDispatches = {
    count: unpostedDispRows.length,
    sample: unpostedDispRows
      .slice(0, 25)
      .map((d) => ({ id: d.id, job_number: jobNum.get(d.job_id) ?? "—", dispatch_date: d.dispatch_date })),
  };
  const unpostedRuns = {
    count: unpostedRunRows.length,
    sample: unpostedRunRows.slice(0, 25).map((r) => {
      const o = opInfo.get(r.operation_id);
      return { id: r.id, code: o?.code ?? null, name: o?.name ?? "—", run_date: r.run_date };
    }),
  };

  return { warehouses, totalNegative, negatives, misplacedSheets, unpostedDispatches, unpostedRuns };
}

export const getInventoryHealth = unstable_cache(_getInventoryHealthUncached, ["inventory-health"], {
  revalidate: 60,
  tags: ["inventory-stock", "jobs"],
});
