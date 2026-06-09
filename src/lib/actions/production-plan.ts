"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { getMrpData } from "@/lib/actions/mrp";

/**
 * Make-shortfall PRODUCTION PLAN: the fewest "other parts" (least over-production)
 * set of AUDITED program runs to cover the Make-type MRP shortfall.
 *
 * - Demand = getMrpData (already in-production + requirement-stage-scoped + dispatch-netted),
 *   filtered to make items with shortfall.
 * - Resolution: a sub-assembly explodes to its parts list; otherwise the item is produced
 *   directly. Stock is netted at every level.
 * - Objective: minimise TOTAL parts produced (== minimise "other parts") while covering every
 *   needed part — a greedy that each round picks the program run with the best useful:produced
 *   ratio, so co-products that are also needed come "for free" and wasteful nests are avoided.
 */

export interface PlanCover {
  code: string;
  name: string;
  type: string;
  category: string; // top-level category
  subCategory: string; // direct (sub-)category
  need: number;
  make: number;
}
export interface PlanProgram {
  code: string;
  name: string;
  machine: string;
  runs: number;
  partsMade: number;
  extra: number;
  covers: PlanCover[];
}
export interface BlockedItem {
  code: string;
  name: string;
  type: string;
  category: string; // top-level category
  subCategory: string; // direct (sub-)category
  need: number;
  missing: { code: string; auditProgram: string | null }[];
}
export interface MakeProductionPlan {
  cutoffDate: string | null;
  totals: {
    shortfallItems: number;
    makeable: number;
    blocked: number;
    programs: number;
    runs: number;
    partsMade: number;
    partsNeeded: number;
    otherParts: number;
  };
  plan: PlanProgram[];
  blocked: BlockedItem[];
}

const PAGE = 1000;
const empty = (c: string | null): MakeProductionPlan => ({
  cutoffDate: c,
  totals: { shortfallItems: 0, makeable: 0, blocked: 0, programs: 0, runs: 0, partsMade: 0, partsNeeded: 0, otherParts: 0 },
  plan: [],
  blocked: [],
});

export async function getMakeProductionPlan(cutoffDate?: string): Promise<MakeProductionPlan> {
  const key = cutoffDate ?? "__all__";
  return unstable_cache(_getPlanUncached, ["make-production-plan", key], {
    revalidate: 60,
    tags: ["jobs", "bom-lines", "items", "inventory-stock", "operations"],
  })(cutoffDate);
}

async function _getPlanUncached(cutoffDate?: string): Promise<MakeProductionPlan> {
  const supabase = createCacheClient();

  // 1) Make shortfall from the live MRP calc
  const mrp = await getMrpData(cutoffDate);
  const short = new Map<string, { shortfall: number; code: string; name: string; category: string }>();
  for (const r of mrp) {
    if (r.procurement_type === "make" && r.shortfall > 0)
      short.set(r.item_id, { shortfall: r.shortfall, code: r.item_code, name: r.item_name, category: r.category_name ?? "(none)" });
  }
  if (short.size === 0) return empty(cutoffDate ?? null);

  // 2) parts lists (item_bom_lines): parent -> [{child, qty}]
  const partsOf = new Map<string, { child: string; qty: number }[]>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase
      .from("item_bom_lines")
      .select("parent_item_id, child_item_id, qty")
      .order("parent_item_id")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    for (const b of data ?? []) {
      if (!b.child_item_id) continue;
      const a = partsOf.get(b.parent_item_id as string) ?? [];
      a.push({ child: b.child_item_id as string, qty: Number(b.qty) || 1 });
      partsOf.set(b.parent_item_id as string, a);
    }
    if (!data || data.length < PAGE) break;
  }

  // 3) involved items = shortfall finished + all parts-list descendants
  const involved = new Set<string>(short.keys());
  const stack = [...short.keys()];
  while (stack.length) {
    const it = stack.pop() as string;
    for (const { child } of partsOf.get(it) ?? []) if (!involved.has(child)) { involved.add(child); stack.push(child); }
  }
  const invIds = [...involved];

  // 4) item info, category procurement, stock — for involved items
  const itemInfo = new Map<string, any>();
  for (let i = 0; i < invIds.length; i += 150) {
    const { data, error } = await supabase
      .from("items")
      .select("id, code, name, category_id, procurement_type, stock_behaviour, item_type")
      .in("id", invIds.slice(i, i + 150));
    if (error) throw error;
    for (const it of data ?? []) itemInfo.set(it.id as string, it);
  }
  const catProc = new Map<string, { name: string | null; procurement_type: string | null; parent_id: string | null }>();
  {
    const { data } = await supabase.from("item_categories").select("id, name, procurement_type, parent_id");
    for (const c of data ?? []) catProc.set(c.id as string, { name: c.name as string, procurement_type: c.procurement_type as string | null, parent_id: (c.parent_id as string | null) ?? null });
  }
  const stock = new Map<string, number>();
  for (let i = 0; i < invIds.length; i += 150) {
    const { data, error } = await supabase.from("inventory").select("item_id, quantity").in("item_id", invIds.slice(i, i + 150));
    if (error) throw error;
    for (const v of data ?? []) stock.set(v.item_id as string, (stock.get(v.item_id as string) ?? 0) + Number(v.quantity || 0));
  }
  const effProc = (id: string) => {
    const it = itemInfo.get(id) ?? {};
    return it.procurement_type ?? (it.category_id ? catProc.get(it.category_id)?.procurement_type : null) ?? null;
  };
  const catName = (id: string) => (itemInfo.get(id)?.category_id ? catProc.get(itemInfo.get(id).category_id)?.name : null) ?? "(none)";
  const topCatName = (id: string) => {
    const start = itemInfo.get(id)?.category_id as string | null | undefined;
    if (!start) return "(none)";
    let cid: string = start;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cid)) break;
      seen.add(cid);
      const parent = catProc.get(cid)?.parent_id;
      if (!parent) break;
      cid = parent;
    }
    return catProc.get(cid)?.name ?? "(none)";
  };
  const itemType = (id: string) => (itemInfo.get(id)?.item_type as string) ?? "—";
  const code = (id: string) => (itemInfo.get(id)?.code as string) ?? id;
  const name = (id: string) => (itemInfo.get(id)?.name as string) ?? "";
  const isMakeLeaf = (id: string) => effProc(id) !== "trade"; // phantom/make/unknown -> make; trade -> buy

  // 5) producers (component + cut_part) for involved items, split audited / pending
  const ops = new Map<string, any>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase.from("operations").select("id, name, code, machine, audited_at").eq("is_active", true).order("id").range(off, off + PAGE - 1);
    if (error) throw error;
    for (const o of data ?? []) ops.set(o.id as string, o);
    if (!data || data.length < PAGE) break;
  }
  const aud = new Map<string, Map<string, number>>();
  const pend = new Map<string, Map<string, number>>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase
      .from("operation_outputs")
      .select("operation_id, item_id, qty_per_run, role")
      .not("item_id", "is", null)
      .gt("qty_per_run", 0)
      .in("role", ["component", "cut_part"])
      .order("id")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    for (const o of data ?? []) {
      if (!involved.has(o.item_id as string)) continue;
      const op = ops.get(o.operation_id as string);
      if (!op) continue;
      const m = op.audited_at ? aud : pend;
      const inner = m.get(o.item_id as string) ?? new Map<string, number>();
      inner.set(o.operation_id as string, (inner.get(o.operation_id as string) ?? 0) + Number(o.qty_per_run));
      m.set(o.item_id as string, inner);
    }
    if (!data || data.length < PAGE) break;
  }

  // 6) classify each finished item: leaves + makeable / blocked
  const leavesOf = (f: string) => {
    const seen = new Set<string>(), out = new Set<string>(), st = [f];
    while (st.length) {
      const it = st.pop() as string;
      if (seen.has(it)) continue;
      seen.add(it);
      const kids = partsOf.get(it) ?? [];
      if (kids.length) for (const { child } of kids) st.push(child);
      else out.add(it);
    }
    return out;
  };
  const statusOf = new Map<string, { kind: string; missing: string[] }>();
  for (const f of short.keys()) {
    const lv = leavesOf(f);
    const makeLeaves = [...lv].filter(isMakeLeaf);
    const missing = makeLeaves.filter((l) => !aud.has(l));
    if (makeLeaves.length === 0) statusOf.set(f, { kind: "no-make", missing: [] });
    else if (missing.length === 0) statusOf.set(f, { kind: lv.size === 1 && lv.has(f) ? "direct" : "assembly", missing: [] });
    else statusOf.set(f, { kind: "blocked", missing });
  }
  const makeable = [...short.keys()].filter((f) => ["direct", "assembly"].includes(statusOf.get(f)!.kind));

  // 7) topo explosion seeded from makeable finished items -> leaf demand (stock netted at every level)
  const seed = new Set<string>();
  { const st = [...makeable]; while (st.length) { const it = st.pop() as string; if (seed.has(it)) continue; seed.add(it); for (const { child } of partsOf.get(it) ?? []) st.push(child); } }
  const indeg = new Map<string, number>(); for (const it of seed) indeg.set(it, 0);
  for (const it of seed) for (const { child } of partsOf.get(it) ?? []) if (seed.has(child)) indeg.set(child, (indeg.get(child) ?? 0) + 1);
  const queue = [...seed].filter((it) => indeg.get(it) === 0); const topo: string[] = [];
  while (queue.length) { const it = queue.shift() as string; topo.push(it); for (const { child } of partsOf.get(it) ?? []) if (seed.has(child)) { indeg.set(child, indeg.get(child)! - 1); if (indeg.get(child) === 0) queue.push(child); } }
  const demand = new Map<string, number>();
  for (const f of makeable) demand.set(f, (demand.get(f) ?? 0) + short.get(f)!.shortfall + (stock.get(f) ?? 0)); // gross = shortfall + stock so produce nets back to shortfall
  const leafProduce = new Map<string, number>();
  for (const it of topo) {
    const prod = Math.max(0, (demand.get(it) ?? 0) - (stock.get(it) ?? 0));
    if (prod <= 0) continue;
    const kids = partsOf.get(it) ?? [];
    if (kids.length) for (const { child, qty } of kids) demand.set(child, (demand.get(child) ?? 0) + prod * qty);
    else if (isMakeLeaf(it)) leafProduce.set(it, (leafProduce.get(it) ?? 0) + prod);
  }

  // 8) least-waste greedy
  const progOut = new Map<string, Map<string, number>>();
  for (const part of leafProduce.keys()) for (const [op, qty] of aud.get(part) ?? []) { const m = progOut.get(op) ?? new Map<string, number>(); m.set(part, qty); progOut.set(op, m); }
  const remaining = new Map(leafProduce);
  const runs = new Map<string, number>();
  for (;;) {
    let best: string | null = null, bestRatio = -1, bestUseful = -1;
    for (const [op, outs] of progOut) {
      let u = 0, t = 0;
      for (const [part, qty] of outs) { t += qty; u += Math.min(remaining.get(part) ?? 0, qty); }
      if (u > 0 && (u / t > bestRatio || (u / t === bestRatio && u > bestUseful))) { bestRatio = u / t; bestUseful = u; best = op; }
    }
    if (!best) break;
    const outs = progOut.get(best)!;
    let batch = Infinity;
    for (const [part, qty] of outs) { const rem = remaining.get(part) ?? 0; if (rem > 0) batch = Math.min(batch, Math.ceil(rem / qty)); }
    runs.set(best, (runs.get(best) ?? 0) + batch);
    for (const [part, qty] of outs) { const rem = remaining.get(part) ?? 0; if (rem > 0) remaining.set(part, Math.max(0, rem - qty * batch)); }
  }

  // 9) full output bundles of the chosen programs -> "other parts"
  const selIds = [...runs.keys()];
  const fullOut = new Map<string, Map<string, number>>();
  for (let i = 0; i < selIds.length; i += 150) {
    if (!selIds.length) break;
    const { data } = await supabase.from("operation_outputs").select("operation_id, item_id, qty_per_run").in("operation_id", selIds.slice(i, i + 150)).in("role", ["component", "cut_part"]).gt("qty_per_run", 0);
    for (const o of data ?? []) { if (!o.item_id) continue; const m = fullOut.get(o.operation_id as string) ?? new Map<string, number>(); m.set(o.item_id as string, (m.get(o.item_id as string) ?? 0) + Number(o.qty_per_run)); fullOut.set(o.operation_id as string, m); }
  }

  const plan: PlanProgram[] = [];
  for (const [op, r] of [...runs.entries()].sort((a, b) => b[1] - a[1])) {
    const opi = ops.get(op);
    const fout = fullOut.get(op) ?? new Map<string, number>();
    const made = r * [...fout.values()].reduce((s, q) => s + q, 0);
    const coverParts = [...(progOut.get(op)?.keys() ?? [])].filter((p) => leafProduce.has(p));
    const covers: PlanCover[] = coverParts.map((p) => ({ code: code(p), name: name(p), type: itemType(p), category: topCatName(p), subCategory: catName(p), need: Math.round(leafProduce.get(p)!), make: Math.round(r * (progOut.get(op)!.get(p) ?? 0)) }));
    const used = coverParts.reduce((s, p) => s + Math.min(leafProduce.get(p)!, r * (progOut.get(op)!.get(p) ?? 0)), 0);
    plan.push({ code: opi.code, name: opi.name, machine: opi.machine, runs: r, partsMade: Math.round(made), extra: Math.round(made - used), covers });
  }

  const blocked: BlockedItem[] = [];
  for (const f of short.keys()) {
    const st = statusOf.get(f)!;
    if (st.kind !== "blocked") continue;
    const s = short.get(f)!;
    const missing = st.missing.map((l) => {
      const p = pend.get(l);
      const auditProgram = p ? ([...p.keys()].map((o) => ops.get(o)?.code as string).filter(Boolean).sort()[0] ?? null) : null;
      return { code: code(l), auditProgram };
    });
    blocked.push({ code: s.code, name: s.name, type: itemType(f), category: topCatName(f), subCategory: s.category, need: Math.round(s.shortfall), missing });
  }
  blocked.sort((a, b) => b.need - a.need);

  const partsMade = plan.reduce((s, p) => s + p.partsMade, 0);
  const partsNeeded = Math.round([...leafProduce.values()].reduce((s, q) => s + q, 0));
  return {
    cutoffDate: cutoffDate ?? null,
    totals: { shortfallItems: short.size, makeable: makeable.length, blocked: blocked.length, programs: runs.size, runs: [...runs.values()].reduce((s, r) => s + r, 0), partsMade, partsNeeded, otherParts: partsMade - partsNeeded },
    plan,
    blocked,
  };
}
