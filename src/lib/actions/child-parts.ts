"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath } from "next/cache";
import { recordTransaction } from "@/lib/actions/inventory";

/* ------------------------------------------------------------------ *
 * Child Parts — the workbench for the loose pieces programs cut, grouped by
 * the sub-assembly they build.
 *
 *   raw sheet --[program run]--> CHILD PARTS in stock --[BUILD]--> sub-assembly.
 *
 * A "child part" = an item_bom_lines child that a program CUTS (a `cut_part`
 * output). That set is exactly the pieces created by program runs, and it never
 * includes trade/bought sub-parts (they are never cut). Program runs from the
 * cutover onward stock these automatically; here the operator can eyeball the
 * stock per sub-assembly, hand-correct a quantity, and build the parent.
 * ------------------------------------------------------------------ */

type Db = Awaited<ReturnType<typeof createClient>>;

export interface ChildPartRow {
  item_id: string;
  code: string | null;
  name: string;
  /** How many of this child ONE parent consumes (item_bom_lines qty). */
  perBuild: number;
  /** Current Main Store stock. */
  stock: number;
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

/**
 * Every sub-assembly that is built from cut child parts, with each child's
 * per-build qty + current stock, sorted by sub-assembly name. Always live (not
 * cached) — stock moves constantly and the set is small (~30 groups).
 */
export async function getChildPartGroups(): Promise<ChildPartGroup[]> {
  const supabase = createCacheClient();

  // 1. The cut-piece children (items a program outputs as cut_part).
  const { data: cutOut } = await supabase
    .from("operation_outputs")
    .select("item_id")
    .eq("role", "cut_part")
    .not("item_id", "is", null);
  const cutIds = new Set((cutOut ?? []).map((o) => o.item_id as string));
  if (cutIds.size === 0) return [];

  // 2. Parts lines whose child is a cut piece → group by parent.
  const { data: lines } = await supabase
    .from("item_bom_lines")
    .select("parent_item_id, child_item_id, qty")
    .in("child_item_id", [...cutIds]);
  type Agg = { parent_id: string; children: Map<string, number> };
  const byParent = new Map<string, Agg>();
  for (const l of lines ?? []) {
    const pid = l.parent_item_id as string;
    const cid = l.child_item_id as string;
    const g = byParent.get(pid) ?? { parent_id: pid, children: new Map<string, number>() };
    g.children.set(cid, (g.children.get(cid) ?? 0) + (Number(l.qty) || 0));
    byParent.set(pid, g);
  }
  if (byParent.size === 0) return [];

  // 3. Item identities + Main Store stock for every parent and child.
  const parentIds = [...byParent.keys()];
  const childIds = [...new Set([...byParent.values()].flatMap((g) => [...g.children.keys()]))];
  const allIds = [...new Set([...parentIds, ...childIds])];
  const { data: items } = await supabase.from("items").select("id, code, name").in("id", allIds);
  const meta = new Map((items ?? []).map((i) => [i.id as string, { code: (i.code as string) ?? null, name: (i.name as string) ?? "(item)" }]));
  const main = await mainStoreId(supabase);
  const stock = main ? await mainStock(supabase, allIds, main) : new Map<string, number>();

  const groups: ChildPartGroup[] = parentIds.map((pid) => {
    const g = byParent.get(pid)!;
    const children: ChildPartRow[] = [...g.children.entries()].map(([cid, perBuild]) => ({
      item_id: cid,
      code: meta.get(cid)?.code ?? null,
      name: meta.get(cid)?.name ?? "(item)",
      perBuild,
      stock: stock.get(cid) ?? 0,
    }));
    children.sort((a, b) => a.name.localeCompare(b.name));
    const maxBuildable = children.reduce((min, c) => {
      const canMake = c.perBuild > 0 ? Math.floor((c.stock < 0 ? 0 : c.stock) / c.perBuild) : Infinity;
      return Math.min(min, canMake);
    }, Infinity);
    return {
      parent_id: pid,
      parent_code: meta.get(pid)?.code ?? null,
      parent_name: meta.get(pid)?.name ?? "(item)",
      parent_stock: stock.get(pid) ?? 0,
      children,
      maxBuildable: Number.isFinite(maxBuildable) ? maxBuildable : 0,
    };
  });
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
