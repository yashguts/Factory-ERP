"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath } from "next/cache";
import { recordTransaction } from "@/lib/actions/inventory";
import type { TransactionType } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * Assembly Runs — build a sub-assembly from its child parts.
 *
 *   raw sheet --[program run]--> loose parts in stock --[ASSEMBLY RUN]-->
 *   parent sub-assembly in stock --[dispatch]--> out.
 *
 * Recording a build CONSUMES the parent's children (item_bom_lines, scaled by
 * qty) from Main Store and PRODUCES the parent into Main Store, posting
 * inventory_transactions tagged reference_type='assembly_run' (idempotent +
 * reversible — same delta-reconcile pattern as program runs). A build is BLOCKED
 * if any child has insufficient Main Store stock (you can't build without parts).
 * ------------------------------------------------------------------ */

type Db = Awaited<ReturnType<typeof createClient>>;

async function mainStoreId(supabase: Db): Promise<string | null> {
  const { data } = await supabase.from("warehouses").select("id").eq("name", "Main Store").maybeSingle();
  return (data?.id as string) ?? null;
}

/** The parent's child parts (item_bom_lines). All rows are 'neutral' today, so
 *  child_item_id is the exact item to consume; summed per child. */
async function getChildren(
  supabase: Db,
  parentId: string,
): Promise<{ item_id: string; qty: number }[]> {
  const { data } = await supabase
    .from("item_bom_lines")
    .select("child_item_id, qty")
    .eq("parent_item_id", parentId)
    .not("child_item_id", "is", null);
  const m = new Map<string, number>();
  for (const r of data ?? [])
    m.set(r.child_item_id as string, (m.get(r.child_item_id as string) ?? 0) + (Number(r.qty) || 0));
  return [...m.entries()].map(([item_id, qty]) => ({ item_id, qty }));
}

/** Stock-on-hand (Main Store) for a set of items. */
async function mainStock(supabase: Db, itemIds: string[], main: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
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
 * Reconcile a build's inventory to `qty` builds by posting only the DELTA vs what
 * this run already posted — correct for record (fresh consume/produce), qty-edit
 * (adjustment delta) and delete (qty=0 → restore). Children consume from Main
 * Store; the parent produces into Main Store.
 */
async function syncAssemblyInventory(supabase: Db, runId: string, parentId: string, qty: number): Promise<void> {
  const main = await mainStoreId(supabase);
  if (!main) return;
  const children = await getChildren(supabase, parentId);

  // Desired signed net per item (all at Main Store).
  const desired = new Map<string, number>();
  const addDesired = (item: string, net: number) => desired.set(item, (desired.get(item) ?? 0) + net);
  addDesired(parentId, +qty);
  for (const c of children) addDesired(c.item_id, -(c.qty * qty));

  // Already-applied net per item from this run's prior assembly_run txns.
  const { data: posted } = await supabase
    .from("inventory_transactions")
    .select("item_id, quantity, transaction_type")
    .eq("reference_type", "assembly_run")
    .eq("reference_id", runId);
  const applied = new Map<string, number>();
  const existing = new Set<string>();
  for (const p of posted ?? []) {
    const item = p.item_id as string;
    existing.add(item);
    const q = Number(p.quantity) || 0;
    const type = p.transaction_type as string;
    const d =
      type === "adjustment" ? q
      : type === "production_in" || type === "purchase_in" || type === "transfer" ? Math.abs(q)
      : -Math.abs(q);
    applied.set(item, (applied.get(item) ?? 0) + d);
  }

  for (const item of new Set<string>([...desired.keys(), ...existing])) {
    const delta = (desired.get(item) ?? 0) - (applied.get(item) ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    let type: TransactionType;
    let q: number;
    if (existing.has(item)) {
      type = "adjustment";
      q = delta;
    } else if (delta > 0) {
      type = "production_in";
      q = delta;
    } else {
      type = "production_out";
      q = -delta;
    }
    await recordTransaction({
      item_id: item,
      warehouse_id: main,
      transaction_type: type,
      quantity: q,
      reference_type: "assembly_run",
      reference_id: runId,
      notes: qty === 0 ? "Assembly run removed — stock restored" : "Assembly run posted to stock",
    });
  }
}

/** True when this run already has system-posted inventory. */
async function runHasInventory(supabase: Db, runId: string): Promise<boolean> {
  const { data } = await supabase
    .from("inventory_transactions")
    .select("id")
    .eq("reference_type", "assembly_run")
    .eq("reference_id", runId)
    .limit(1);
  return !!(data && data.length);
}

// ---- View models -----------------------------------------------------------
export interface AssemblyChildView {
  item_id: string;
  code: string | null;
  name: string;
  /** per ONE parent (item_bom_lines qty). */
  perBuild: number;
  /** current Main Store stock (informational). */
  stock: number;
}
export interface AssemblyRunRow {
  id: string;
  item_id: string;
  code: string | null;
  name: string;
  build_date: string;
  qty: number;
  note: string | null;
  created_at: string;
  children: AssemblyChildView[];
}

function relOne<T>(rel: unknown): T | null {
  if (rel == null) return null;
  return ((Array.isArray(rel) ? rel[0] : rel) ?? null) as T | null;
}

export async function getAssemblyRunsForDate(date: string): Promise<AssemblyRunRow[]> {
  if (!date) return [];
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("assembly_runs")
    .select(
      `id, item_id, build_date, qty, note, created_at,
       item:items!assembly_runs_item_id_fkey(code, name)`,
    )
    .eq("build_date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const runs = data ?? [];

  // children per parent + their stock (one shared read)
  const main = await (async () => {
    const { data: w } = await supabase.from("warehouses").select("id").eq("name", "Main Store").maybeSingle();
    return (w?.id as string) ?? null;
  })();
  const parentIds = [...new Set(runs.map((r) => r.item_id as string))];
  const childrenByParent = new Map<string, AssemblyChildView[]>();
  if (parentIds.length) {
    const { data: bom } = await supabase
      .from("item_bom_lines")
      .select(
        `parent_item_id, qty,
         child:items!item_bom_lines_child_item_id_fkey(id, code, name)`,
      )
      .in("parent_item_id", parentIds)
      .not("child_item_id", "is", null);
    const childIds = [
      ...new Set((bom ?? []).map((b) => relOne<{ id: string }>(b.child)?.id).filter(Boolean) as string[]),
    ];
    const stock = main ? await mainStock(supabase, childIds, main) : new Map<string, number>();
    for (const b of bom ?? []) {
      const ch = relOne<{ id: string; code: string; name: string }>(b.child);
      if (!ch) continue;
      const arr = childrenByParent.get(b.parent_item_id as string) ?? [];
      arr.push({
        item_id: ch.id,
        code: ch.code ?? null,
        name: ch.name ?? "(item)",
        perBuild: Number(b.qty) || 0,
        stock: stock.get(ch.id) ?? 0,
      });
      childrenByParent.set(b.parent_item_id as string, arr);
    }
  }

  return runs.map((r) => {
    const it = relOne<{ code: string; name: string }>(r.item);
    return {
      id: r.id as string,
      item_id: r.item_id as string,
      code: it?.code ?? null,
      name: it?.name ?? "(deleted item)",
      build_date: r.build_date as string,
      qty: Number(r.qty) || 0,
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
      children: childrenByParent.get(r.item_id as string) ?? [],
    };
  });
}

export interface BuildableItem {
  id: string;
  code: string;
  name: string;
  childCount: number;
}

/** Search items that HAVE a parts list (can be built) — the Build picker. */
export async function searchBuildableItems(query: string, limit = 20): Promise<BuildableItem[]> {
  const supabase = createCacheClient();
  // parents that have at least one child
  const { data: parents } = await supabase
    .from("item_bom_lines")
    .select("parent_item_id, child_item_id")
    .not("child_item_id", "is", null);
  const childCount = new Map<string, number>();
  for (const p of parents ?? [])
    childCount.set(p.parent_item_id as string, (childCount.get(p.parent_item_id as string) ?? 0) + 1);
  const parentIds = [...childCount.keys()];
  if (parentIds.length === 0) return [];

  let q = supabase
    .from("items")
    .select("id, code, name")
    .eq("is_active", true)
    .in("id", parentIds)
    .order("name")
    .limit(500);
  for (const token of (query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const safe = token.replace(/[%,()]/g, "");
    if (safe) q = q.or(`code.ilike.%${safe}%,name.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])
    .map((i) => ({
      id: i.id as string,
      code: (i.code as string) ?? "",
      name: (i.name as string) ?? "",
      childCount: childCount.get(i.id as string) ?? 0,
    }))
    .slice(0, limit);
}

/** Children of one parent + their stock — for the Build modal (preview + block). */
export async function getBuildPreview(parentId: string): Promise<AssemblyChildView[]> {
  if (!parentId) return [];
  const supabase = createCacheClient();
  const { data } = await supabase
    .from("item_bom_lines")
    .select(`qty, child:items!item_bom_lines_child_item_id_fkey(id, code, name)`)
    .eq("parent_item_id", parentId)
    .not("child_item_id", "is", null);
  const main = await (async () => {
    const { data: w } = await supabase.from("warehouses").select("id").eq("name", "Main Store").maybeSingle();
    return (w?.id as string) ?? null;
  })();
  const rows = (data ?? []).map((b) => ({ ch: relOne<{ id: string; code: string; name: string }>(b.child), qty: Number(b.qty) || 0 }));
  const childIds = rows.map((r) => r.ch?.id).filter(Boolean) as string[];
  const stock = main ? await mainStock(supabase, childIds, main) : new Map<string, number>();
  // sum per child
  const m = new Map<string, AssemblyChildView>();
  for (const { ch, qty } of rows) {
    if (!ch) continue;
    const ex = m.get(ch.id) ?? { item_id: ch.id, code: ch.code ?? null, name: ch.name ?? "(item)", perBuild: 0, stock: stock.get(ch.id) ?? 0 };
    ex.perBuild += qty;
    m.set(ch.id, ex);
  }
  return [...m.values()];
}

export type AssemblyResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordAssemblyRun(input: {
  item_id: string;
  build_date: string;
  qty: number;
  note?: string | null;
}): Promise<AssemblyResult> {
  if (!input.item_id) return { ok: false, error: "Pick a sub-assembly to build." };
  if (!input.build_date) return { ok: false, error: "Pick a date." };
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Build quantity must be greater than 0." };

  const supabase = await createClient();
  const main = await mainStoreId(supabase);
  if (!main) return { ok: false, error: "Main Store warehouse not found." };

  // children + a BLOCK if any has insufficient Main Store stock
  const children = await getChildren(supabase, input.item_id);
  if (children.length === 0) return { ok: false, error: "This item has no parts list — nothing to build from." };
  const stock = await mainStock(supabase, children.map((c) => c.item_id), main);
  const short: string[] = [];
  for (const c of children) {
    const need = c.qty * qty;
    const have = stock.get(c.item_id) ?? 0;
    if (have + 1e-9 < need) short.push(c.item_id);
  }
  if (short.length) {
    // name the short items for a useful message
    const { data: items } = await supabase.from("items").select("id, code, name").in("id", short);
    const byId = new Map((items ?? []).map((i) => [i.id as string, i]));
    const lines = short.map((id) => {
      const it = byId.get(id);
      const c = children.find((x) => x.item_id === id)!;
      return `${it?.code ?? id} ${it?.name ?? ""} (need ${c.qty * qty}, have ${stock.get(id) ?? 0})`;
    });
    return { ok: false, error: `Not enough stock to build:\n${lines.join("\n")}` };
  }

  const { data, error } = await supabase
    .from("assembly_runs")
    .insert({ item_id: input.item_id, build_date: input.build_date, qty, note: input.note?.trim() || null })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  try {
    await syncAssemblyInventory(supabase, data.id as string, input.item_id, qty);
  } catch (e) {
    console.error("assembly run inventory post failed", data.id, e);
  }
  revalidatePath("/assembly-runs");
  return { ok: true, id: data.id as string };
}

export async function updateAssemblyRunQty(id: string, qty: number): Promise<AssemblyResult> {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Quantity must be greater than 0." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("assembly_runs").select("item_id, qty").eq("id", id).maybeSingle();
  if (!run) return { ok: false, error: "Build not found." };

  // BLOCK if increasing beyond available child stock (only the extra delta needs to be on hand)
  const main = await mainStoreId(supabase);
  if (main && n > Number(run.qty)) {
    const children = await getChildren(supabase, run.item_id as string);
    const stock = await mainStock(supabase, children.map((c) => c.item_id), main);
    const extra = n - Number(run.qty);
    for (const c of children) {
      if ((stock.get(c.item_id) ?? 0) + 1e-9 < c.qty * extra)
        return { ok: false, error: "Not enough child-part stock to increase this build." };
    }
  }

  const { error } = await supabase.from("assembly_runs").update({ qty: n, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  try {
    if (await runHasInventory(supabase, id)) await syncAssemblyInventory(supabase, id, run.item_id as string, n);
  } catch (e) {
    console.error("assembly run re-sync failed", id, e);
  }
  revalidatePath("/assembly-runs");
  return { ok: true, id };
}

export async function deleteAssemblyRun(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("assembly_runs").select("item_id").eq("id", id).maybeSingle();
  try {
    if (run && (await runHasInventory(supabase, id)))
      await syncAssemblyInventory(supabase, id, run.item_id as string, 0);
  } catch (e) {
    console.error("assembly run reversal failed", id, e);
  }
  const { error } = await supabase.from("assembly_runs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/assembly-runs");
  return { ok: true };
}
