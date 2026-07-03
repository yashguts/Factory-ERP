"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { revalidatePath } from "next/cache";
import { recordTransaction } from "@/lib/actions/inventory";
import { CUTOVER_DATE } from "@/lib/inventory/cutover";

/* ------------------------------------------------------------------ *
 * Child Parts — the workbench for building sub-assemblies from their parts.
 *
 *   raw sheet --[program run]--> child parts in stock --[BUILD]--> sub-assembly.
 *
 * A group = a "true sub-assembly" (an item_bom_lines parent with >=1 MAKE child;
 * glass-only door panels, whose children are all trade, are NOT assemblies). Each
 * group shows its FULL parts list, every child labelled by kind:
 *   - cut   : a piece a program cuts (a `cut_part` output) — stocked by runs.
 *   - made  : a made sub-part produced by a program `component` output.
 *   - trade : a bought/procured part (effective procurement = 'trade').
 * Building CONSUMES every child from Main Store and produces the parent, so all
 * three kinds net into inventory + Make/Trade MRP. The operator can also hand-
 * correct any child's count.
 * ------------------------------------------------------------------ */

type Db = Awaited<ReturnType<typeof createClient>>;

export type ChildKind = "cut" | "made" | "trade";

export interface ChildPartRow {
  item_id: string;
  code: string | null;
  name: string;
  /** How many of this child ONE parent consumes (item_bom_lines qty). */
  perBuild: number;
  /** Current Main Store stock. */
  stock: number;
  /** cut piece / made sub-part / trade (bought) part. */
  kind: ChildKind;
}

export interface ChildPartGroup {
  parent_id: string;
  parent_code: string | null;
  parent_name: string;
  /** Current Main Store stock of the finished sub-assembly. */
  parent_stock: number;
  children: ChildPartRow[];
  /** How many parents can be built from child stock right now (min over children). */
  maxBuildable: number;
}

async function mainStoreId(supabase: Db): Promise<string | null> {
  const { data } = await supabase.from("warehouses").select("id").eq("name", "Main Store").maybeSingle();
  return (data?.id as string) ?? null;
}

/** Split ids into 300-id chunks (bounds URL length + the 1000-row cap). */
function chunked(ids: string[], size = 300): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Main Store stock for a set of items. Chunks are disjoint id sets, so they
 *  fetch concurrently — one round-trip wave instead of one per chunk. */
async function mainStock(supabase: Db, itemIds: string[], main: string): Promise<Map<string, number>> {
  const results = await Promise.all(
    chunked(itemIds).map((ids) =>
      supabase
        .from("inventory")
        .select("item_id, quantity")
        .eq("warehouse_id", main)
        .in("item_id", ids),
    ),
  );
  const out = new Map<string, number>();
  for (const { data } of results)
    for (const r of data ?? [])
      out.set(r.item_id as string, (out.get(r.item_id as string) ?? 0) + (Number(r.quantity) || 0));
  return out;
}

/** Fetch a column set for many item ids — chunked, all chunks concurrent. */
async function fetchItemsChunked(
  supabase: Db,
  ids: string[],
): Promise<Map<string, { code: string | null; name: string; procurement_type: string | null; category_id: string | null }>> {
  const results = await Promise.all(
    chunked(ids).map((batch) =>
      supabase
        .from("items")
        .select("id, code, name, procurement_type, category_id")
        .in("id", batch),
    ),
  );
  const out = new Map<string, { code: string | null; name: string; procurement_type: string | null; category_id: string | null }>();
  for (const { data } of results)
    for (const it of data ?? [])
      out.set(it.id as string, {
        code: (it.code as string) ?? null,
        name: (it.name as string) ?? "(item)",
        procurement_type: (it.procurement_type as string | null) ?? null,
        category_id: (it.category_id as string | null) ?? null,
      });
  return out;
}

const KIND_RANK: Record<ChildKind, number> = { cut: 0, made: 1, trade: 2 };

/**
 * The sub-assemblies whose child parts have been cut by a program run ON/AFTER
 * the cutover (CUTOVER_DATE) — the page starts there and grows as more runs
 * happen. Each qualifying sub-assembly shows its FULL parts list, every child
 * labelled cut/made/trade + per-build qty + live Main Store stock, sorted by
 * name. Always live (not cached) — stock moves constantly, the set is small.
 */
export async function getChildPartGroups(): Promise<ChildPartGroup[]> {
  const supabase = createCacheClient();

  // Wave 1 — five independent reads, fetched concurrently: full parts list
  // (paged past the 1000-row cap), category procurement defaults, every
  // cut-piece output WITH its operation_id (so the cutover gate below becomes
  // a pure in-memory intersection instead of a second outputs query), the Main
  // Store id, and the post-cutover runs.
  const [bomLines, { data: cats }, cutRows, main, { data: recentRuns }] = await Promise.all([
    fetchAllRanged<{ parent_item_id: string; child_item_id: string; qty: number }>((from, to, withCount) =>
      supabase
        .from("item_bom_lines")
        .select("parent_item_id, child_item_id, qty", withCount ? { count: "exact" } : {})
        .not("child_item_id", "is", null)
        // Deterministic order so parallel page slices can't duplicate/miss rows.
        .order("id")
        .range(from, to),
    ),
    supabase.from("item_categories").select("id, procurement_type"),
    fetchAllRanged<{ item_id: string; operation_id: string }>((from, to, withCount) =>
      supabase
        .from("operation_outputs")
        .select("item_id, operation_id", withCount ? { count: "exact" } : {})
        .eq("role", "cut_part")
        .not("item_id", "is", null)
        .order("id")
        .range(from, to),
      // Label-only data (kind chip + cutover gate) — degrade to made/trade
      // labels on a transient read failure rather than error the whole page.
    ).catch(() => [] as { item_id: string; operation_id: string }[]),
    mainStoreId(supabase),
    supabase.from("operation_runs").select("operation_id").gte("run_date", CUTOVER_DATE),
  ]);

  // Group children per parent.
  const byParent = new Map<string, Map<string, number>>();
  for (const l of bomLines) {
    const pid = l.parent_item_id as string;
    const cid = l.child_item_id as string;
    const kids = byParent.get(pid) ?? new Map<string, number>();
    kids.set(cid, (kids.get(cid) ?? 0) + (Number(l.qty) || 0));
    byParent.set(pid, kids);
  }
  if (byParent.size === 0) return [];

  // Wave 2 — item identities + Main Store stock (both keyed by wave 1's id set).
  // Effective procurement = item.procurement_type ?? category.procurement_type;
  // cut-piece set drives the kind label.
  const parentIds = [...byParent.keys()];
  const childIds = [...new Set([...byParent.values()].flatMap((k) => [...k.keys()]))];
  const allIds = [...new Set([...parentIds, ...childIds])];
  const [meta, stock] = await Promise.all([
    fetchItemsChunked(supabase, allIds),
    main ? mainStock(supabase, allIds, main) : Promise.resolve(new Map<string, number>()),
  ]);
  const catProc = new Map((cats ?? []).map((c) => [c.id as string, (c.procurement_type as string | null) ?? null]));
  const cutIds = new Set(cutRows.map((o) => o.item_id));
  const effProc = (id: string): string | null => {
    const it = meta.get(id);
    return it?.procurement_type ?? (it?.category_id ? catProc.get(it.category_id) ?? null : null);
  };

  // Cutover gate: a sub-assembly appears only once at least one of its child
  // parts has been CUT by a program run on/after the cutover (CUTOVER_DATE). The
  // page starts from the cutover and grows as more runs happen — older / never-run
  // sub-assemblies are omitted for now (owner: "only going forward we'll keep
  // adding here"). producedSince = cut_part outputs of the post-cutover runs —
  // intersected in memory from the wave-1 reads.
  const recentOpIds = new Set((recentRuns ?? []).map((r) => r.operation_id as string));
  const producedSince = new Set<string>();
  for (const o of cutRows) if (recentOpIds.has(o.operation_id)) producedSince.add(o.item_id);

  const groups: ChildPartGroup[] = [];
  for (const pid of parentIds) {
    const kids = byParent.get(pid)!;
    // Only sub-assemblies whose child parts have been cut by a >= cutover program
    // run (this also implies a make child, since cut parts are make). Others are
    // omitted for now and appear as their programs run going forward.
    if (![...kids.keys()].some((cid) => producedSince.has(cid))) continue;

    const children: ChildPartRow[] = [...kids.entries()].map(([cid, perBuild]) => {
      const ep = effProc(cid);
      const kind: ChildKind = ep === "trade" ? "trade" : cutIds.has(cid) ? "cut" : "made";
      return {
        item_id: cid,
        code: meta.get(cid)?.code ?? null,
        name: meta.get(cid)?.name ?? "(item)",
        perBuild,
        stock: stock.get(cid) ?? 0,
        kind,
      };
    });
    children.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name));
    const maxBuildable = children.reduce((min, c) => {
      const canMake = c.perBuild > 0 ? Math.floor((c.stock < 0 ? 0 : c.stock) / c.perBuild) : Infinity;
      return Math.min(min, canMake);
    }, Infinity);
    groups.push({
      parent_id: pid,
      parent_code: meta.get(pid)?.code ?? null,
      parent_name: meta.get(pid)?.name ?? "(item)",
      parent_stock: stock.get(pid) ?? 0,
      children,
      maxBuildable: Number.isFinite(maxBuildable) ? maxBuildable : 0,
    });
  }
  groups.sort((a, b) => a.parent_name.localeCompare(b.parent_name));
  return groups;
}

export type AdjustResult = { ok: true } | { ok: false; error: string };

/**
 * Hand-correct a child part's Main Store stock to an exact quantity — posts the
 * signed difference as an `adjustment` (attributed to the operator cookie by
 * recordTransaction), tagged reference_type='child_part_adjust'.
 */
export async function adjustChildPartStock(itemId: string, targetQty: number): Promise<AdjustResult> {
  if (!itemId) return { ok: false, error: "Missing item." };
  const target = Number(targetQty);
  if (!Number.isFinite(target)) return { ok: false, error: "Enter a valid quantity." };

  const supabase = await createClient();
  const main = await mainStoreId(supabase);
  if (!main) return { ok: false, error: "Main Store warehouse not found." };

  const { data: row } = await supabase
    .from("inventory")
    .select("quantity")
    .eq("item_id", itemId)
    .eq("warehouse_id", main)
    .maybeSingle();
  const current = Number(row?.quantity) || 0;
  const delta = target - current;
  if (Math.abs(delta) < 1e-9) return { ok: true };

  try {
    await recordTransaction({
      item_id: itemId,
      warehouse_id: main,
      transaction_type: "adjustment",
      quantity: delta,
      reference_type: "child_part_adjust",
      notes: `Child-part stock set to ${target}`,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Adjustment failed." };
  }
  revalidatePath("/child-parts");
  return { ok: true };
}
