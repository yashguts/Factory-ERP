"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
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

/** Main Store stock for a set of items (paged to dodge the 1000-row cap). */
async function mainStock(supabase: Db, itemIds: string[], main: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < itemIds.length; i += 300) {
    const { data } = await supabase
      .from("inventory")
      .select("item_id, quantity")
      .eq("warehouse_id", main)
      .in("item_id", itemIds.slice(i, i + 300));
    for (const r of data ?? [])
      out.set(r.item_id as string, (out.get(r.item_id as string) ?? 0) + (Number(r.quantity) || 0));
  }
  return out;
}

/** Fetch a column set for many item ids, chunked to dodge URL-length + row caps. */
async function fetchItemsChunked(
  supabase: Db,
  ids: string[],
): Promise<Map<string, { code: string | null; name: string; procurement_type: string | null; category_id: string | null }>> {
  const out = new Map<string, { code: string | null; name: string; procurement_type: string | null; category_id: string | null }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, procurement_type, category_id")
      .in("id", ids.slice(i, i + 300));
    for (const it of data ?? [])
      out.set(it.id as string, {
        code: (it.code as string) ?? null,
        name: (it.name as string) ?? "(item)",
        procurement_type: (it.procurement_type as string | null) ?? null,
        category_id: (it.category_id as string | null) ?? null,
      });
  }
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

  // 1. Full parts list (paged past the 1000-row cap). Group children per parent.
  const byParent = new Map<string, Map<string, number>>();
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase
      .from("item_bom_lines")
      .select("parent_item_id, child_item_id, qty")
      .not("child_item_id", "is", null)
      .range(off, off + 999);
    const batch = data ?? [];
    for (const l of batch) {
      const pid = l.parent_item_id as string;
      const cid = l.child_item_id as string;
      const kids = byParent.get(pid) ?? new Map<string, number>();
      kids.set(cid, (kids.get(cid) ?? 0) + (Number(l.qty) || 0));
      byParent.set(pid, kids);
    }
    if (batch.length < 1000) break;
  }
  if (byParent.size === 0) return [];

  // 2. Item identities + effective procurement (item.procurement_type ??
  //    category.procurement_type) + cut-piece set (for the kind label) + stock.
  const parentIds = [...byParent.keys()];
  const childIds = [...new Set([...byParent.values()].flatMap((k) => [...k.keys()]))];
  const allIds = [...new Set([...parentIds, ...childIds])];
  const [meta, { data: cats }, { data: cutOut }, main, { data: recentRuns }] = await Promise.all([
    fetchItemsChunked(supabase, allIds),
    supabase.from("item_categories").select("id, procurement_type"),
    supabase.from("operation_outputs").select("item_id").eq("role", "cut_part").not("item_id", "is", null),
    mainStoreId(supabase),
    supabase.from("operation_runs").select("operation_id").gte("run_date", CUTOVER_DATE),
  ]);
  const catProc = new Map((cats ?? []).map((c) => [c.id as string, (c.procurement_type as string | null) ?? null]));
  const cutIds = new Set((cutOut ?? []).map((o) => o.item_id as string));
  const stock = main ? await mainStock(supabase, allIds, main) : new Map<string, number>();
  const effProc = (id: string): string | null => {
    const it = meta.get(id);
    return it?.procurement_type ?? (it?.category_id ? catProc.get(it.category_id) ?? null : null);
  };

  // Cutover gate: a sub-assembly appears only once at least one of its child
  // parts has been CUT by a program run on/after the cutover (CUTOVER_DATE). The
  // page starts from the cutover and grows as more runs happen — older / never-run
  // sub-assemblies are omitted for now (owner: "only going forward we'll keep
  // adding here"). producedSince = cut_part outputs of the post-cutover runs.
  const recentOpIds = [...new Set((recentRuns ?? []).map((r) => r.operation_id as string))];
  const producedSince = new Set<string>();
  for (let i = 0; i < recentOpIds.length; i += 300) {
    const { data } = await supabase
      .from("operation_outputs")
      .select("item_id")
      .eq("role", "cut_part")
      .not("item_id", "is", null)
      .in("operation_id", recentOpIds.slice(i, i + 300));
    for (const o of data ?? []) producedSince.add(o.item_id as string);
  }

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
