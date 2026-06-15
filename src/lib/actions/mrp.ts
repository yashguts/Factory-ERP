"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { _getItemsWithStockUncached } from "@/lib/actions/inventory";
import { _getOutstandingByItemUncached } from "@/lib/actions/po-outstanding";
import { dispatchPhaseOf } from "@/lib/bom/bom-sections";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

export interface MrpRow {
  item_id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  category_name: string | null;
  /** Top-level (root) category, resolved by walking parent_id to the tree root.
   *  Drives the category grouping on the Requirements pages. Null when the item
   *  has no category at all. */
  top_category_name: string | null;
  uom_abbreviation: string | null;
  total_required: number;
  total_stock: number;
  shortfall: number;
  /** Outstanding (on-order, not-yet-received) qty from open purchase orders. */
  on_order: number;
  /** Net still to procure = max(0, shortfall − on_order). The item still shows
   *  when shortfall>0 even if to_buy is 0 (i.e. fully covered by a PO). */
  to_buy: number;
  job_count: number;
  /**
   * Effective procurement type. items.procurement_type takes precedence;
   * falls back to the (sub-)category's procurement_type. NULL only when
   * neither is set (shouldn't happen with current data but guarded for
   * future categories that haven't been classified yet).
   */
  procurement_type: "make" | "trade" | null;
}

/** A demand accumulator entry. `jobIds` carries the contributing jobs directly
 *  for demand that isn't tied to a BOM header (job-attribute rules below). */
type ReqEntry = { total: number; bomIds: Set<string>; jobIds?: Set<string> };

/**
 * Job-attribute demand rules — parts a lift needs based on the job's drive_type,
 * NOT via the BOM (these parts aren't components of any BOM item, so they can't be
 * modelled with item_bom_lines). Counted per in-production job whose drive_type
 * matches, `qtyPerJob` each, regardless of requirement stage (owner's rule).
 * Owner (2026-06-15): Home/Belt lifts need 4× Main guide-shoe liner (GS-002) and
 * 4× Home guide-shoe liner (GS-005). Add new drive-type rules here.
 *
 * Only folded in when includeDerivedTrade is on (getMrpData table + Procurement);
 * the optimiser / production plan never see these (they're bought, not made).
 */
const JOB_DRIVE_DEMAND: { code: string; driveTypes: string[]; qtyPerJob: number }[] = [
  { code: "GS-002", driveTypes: ["HOME", "BELT"], qtyPerJob: 4 },
  { code: "GS-005", driveTypes: ["HOME", "BELT"], qtyPerJob: 4 },
];

export async function getMrpData(cutoffDate?: string): Promise<MrpRow[]> {
  const key = cutoffDate ?? "__all__";
  return unstable_cache(
    // The MRP table + Procurement want trade parts that sit under made items
    // (e.g. door shoes inside collapsible gates) folded in — that's the opt-in.
    (c?: string) => _getMrpDataUncached(c, true),
    ["mrp-data", key],
    // "purchase-orders" tag: MRP now nets outstanding POs into on_order/to_buy,
    // so a PO create/receive must refresh the figures (procurement mutations
    // revalidate this tag).
    { revalidate: 1800, tags: ["jobs", "bom-lines", "items", "inventory-stock", "purchase-orders"] },
  )(cutoffDate);
}

/**
 * Ad-hoc shortfall for an explicit set of jobs (the /mrp/shortfall tool). NOT
 * cached — the job set is user-chosen and effectively unique per request, so a
 * cache would rarely hit and would need awkward invalidation. Mirrors the MRP
 * table math (includeDerivedTrade on: trade leaves + component rules + drive-type
 * demand), scoped to exactly these jobs. Returns make AND trade rows; the client
 * groups them by category. status/cutoff are ignored — the owner picked the jobs.
 */
export async function getAdHocShortfall(jobIds: string[]): Promise<MrpRow[]> {
  if (!jobIds || jobIds.length === 0) return [];
  return _getMrpDataUncached(undefined, true, jobIds);
}

/** The hard-coded drive-type demand rules, exposed for the Settings rule doc.
 *  (Can't export the const itself from a "use server" module.) */
export async function getJobDriveDemandRules(): Promise<
  { code: string; driveTypes: string[]; qtyPerJob: number }[]
> {
  return JOB_DRIVE_DEMAND;
}

/**
 * @param includeDerivedTrade  Fold trade parts consumed by made items (via
 *   item_bom_lines) into demand. OFF by default so explosion/optimiser consumers
 *   (getProductionPlan, the locked make-plan) keep exploding DIRECT demand and
 *   surface those leaves themselves — turning it on for them would double-count.
 *   getMrpData (the table + Procurement) opts in.
 */
export async function _getMrpDataUncached(
  cutoffDate?: string,
  includeDerivedTrade = false,
  /**
   * Ad-hoc scope: when a non-null list is given, demand is computed for EXACTLY
   * these job ids (the status=in_production filter and the cutoff date are both
   * ignored — the owner explicitly picked the jobs). Requirement-stage scoping and
   * dispatch netting still apply, so the result matches what MRP would attribute to
   * those jobs. Used by getAdHocShortfall; null/undefined keeps the normal behaviour.
   */
  jobIds?: string[] | null,
): Promise<MrpRow[]> {
  const supabase = createCacheClient();
  const adHoc = jobIds != null;
  if (adHoc && jobIds!.length === 0) return [];

  // Demand comes ONLY from jobs in production (exclude new/hold), optionally within
  // the "dispatch date up to" cutoff. Capture each job's requirement_stage so a
  // first-phase job pulls only its first-phase material. In ad-hoc mode we scope to
  // the explicit id list instead.
  const stageByJob = new Map<string, string>();
  // drive_type per in-production (in-scope) job, for the job-attribute demand rules.
  const driveByJob = new Map<string, string | null>();
  {
    const jobs = await fetchAllRanged<{ id: string; requirement_stage: string | null; drive_type: string | null }>(
      (from, to, withCount) => {
        let q = supabase
          .from("jobs")
          .select("id, requirement_stage, drive_type", withCount ? { count: "exact" } : {});
        if (adHoc) {
          q = q.in("id", jobIds!);
        } else {
          q = q.eq("status", "in_production");
          if (cutoffDate) q = q.lte("requirement_dispatch_date", cutoffDate);
        }
        return q.range(from, to);
      },
    );
    // No Required set ⇒ treat as "new" (counts nothing), never "full". A blank
    // requirement must not silently pull a job's entire BOM into demand.
    for (const j of jobs) {
      stageByJob.set(j.id, j.requirement_stage ?? "new");
      driveByJob.set(j.id, j.drive_type ?? null);
    }
  }
  if (stageByJob.size === 0) return [];
  const prodJobIds = Array.from(stageByJob.keys());

  // Dispatched-so-far per BOM line. Dispatch (any phase: first/second/full) is
  // netted out of MRP demand, so already-shipped material stops showing as
  // "required". Keyed by job_bom_line_id — the same definition the dispatch
  // panel uses for "Remaining" (getJobDispatchSummary). Ad-hoc dispatch lines
  // (null job_bom_line_id) aren't tied to a BOM line, so they don't reduce demand.
  //
  // This scans the whole job_dispatch_lines table, so it doesn't depend on the
  // header -> lines chain below. Kick it off concurrently and await it just
  // before we need it (when netting demand), saving one cross-region round-trip
  // hop. Behaviour is identical — same rows, same accumulation.
  const dispatchedByLinePromise = (async () => {
    const dispatchedByLine = new Map<string, number>();
    const rows = await fetchAllRanged<{ job_bom_line_id: string; qty: number }>(
      (from, to, withCount) =>
        supabase
          .from("job_dispatch_lines")
          .select("job_bom_line_id, qty", withCount ? { count: "exact" } : {})
          .not("job_bom_line_id", "is", null)
          .range(from, to),
    );
    for (const d of rows) {
      dispatchedByLine.set(
        d.job_bom_line_id,
        (dispatchedByLine.get(d.job_bom_line_id) ?? 0) + (Number(d.qty) || 0),
      );
    }
    return dispatchedByLine;
  })();

  // Header -> job map (drives both the stage scope below and job_count later).
  const headerToJob = new Map<string, string>();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < prodJobIds.length; i += 200)
      chunks.push(prodJobIds.slice(i, i + 200));
    const results = await Promise.all(
      chunks.map((ids) =>
        supabase.from("job_bom_headers").select("id, job_id").in("job_id", ids),
      ),
    );
    for (const { data, error } of results) {
      if (error) throw error;
      for (const h of data ?? [])
        headerToJob.set(h.id as string, h.job_id as string);
    }
  }
  if (headerToJob.size === 0) {
    // Drain the in-flight dispatch query so we don't leave an unhandled rejection.
    await dispatchedByLinePromise;
    return [];
  }
  const bomHeaderIds = Array.from(headerToJob.keys());

  // BOM lines for those headers. `category` lets us scope first-phase jobs to
  // their first-phase sections (dispatchPhaseOf).
  const allLines: any[] = await fetchAllRanged(
    (from, to, withCount) =>
      supabase
        .from("job_bom_lines")
        .select(
          "id, item_id, required_quantity, job_bom_id, category",
          withCount ? { count: "exact" } : {},
        )
        .in("job_bom_id", bomHeaderIds)
        .not("item_id", "is", null)
        .gt("required_quantity", 0)
        .range(from, to),
  );

  const dispatchedByLine = await dispatchedByLinePromise;

  // total = sum of NET required_quantity across all BOM lines for the item,
  // where net = required − dispatched (floored at 0). Lines fully dispatched
  // contribute nothing; an item whose lines all net to 0 drops out entirely.
  const reqMap = new Map<string, ReqEntry>();
  for (const line of allLines) {
    // Requirement-stage scope: full_material -> all sections; first_phase ->
    // first-phase sections only; new -> nothing (not yet required).
    const jobId = headerToJob.get(line.job_bom_id);
    const stage = jobId ? stageByJob.get(jobId) : undefined;
    if (!stage || stage === "new") continue;
    if (
      stage === "first_phase" &&
      dispatchPhaseOf((line.category as string) ?? "") !== "first"
    )
      continue;
    const required = Number(line.required_quantity) || 0;
    const dispatched = dispatchedByLine.get(line.id) ?? 0;
    const qty = Math.max(0, required - dispatched);
    if (qty <= 0) continue; // fully dispatched — no remaining demand
    const existing = reqMap.get(line.item_id);
    if (existing) {
      existing.total += qty;
      existing.bomIds.add(line.job_bom_id);
    } else {
      reqMap.set(line.item_id, {
        total: qty,
        bomIds: new Set([line.job_bom_id]),
      });
    }
  }

  // ── Derived demand: trade parts consumed by made items ────────────────────
  // A purchased (trade) part can sit UNDER a made item via its assembly parts
  // list (item_bom_lines) — e.g. a Collapsible Gate is "built from" 15 cast-iron
  // door shoes. Those shoes are real procurement demand but never appear on a job
  // BOM directly, so the direct sum above misses them (the item shows as "No
  // link"). Walk each demanded MAKE item down its parts list and add any TRADE
  // leaves to demand, attributed to the same jobs. Make sub-parts are left to the
  // production plan — this only surfaces things to BUY. Mirrors getProductionPlan's
  // explode: based on REQUIRED (not shortfall, so it agrees with /mrp/plan's
  // purchased list), and resolves children by the stored representative
  // (child_item_id) — exact for the current data (all 'neutral'); revisit to share
  // getProductionPlan's finish resolution if finish-banded trade sub-parts appear.
  // Component-demand rules (e.g. guide shoes per safety frame) are REAL make/trade
  // demand that no parts-list explosion will ever re-derive (by design they don't
  // touch the production plan), so they apply to EVERY consumer — crucially the
  // make-plan optimiser (production-plan.ts calls this with includeDerivedTrade=false),
  // which otherwise never sees the guide-shoe demand and so never schedules its
  // programs. No double-count: the make-plan's own explosion goes through item_bom_lines,
  // and these rules are deliberately NOT in item_bom_lines. Must run before
  // addTradeLeafDemand so a rule-added child's own trade leaves get exploded below.
  await addComponentRuleDemand(supabase, reqMap);
  if (includeDerivedTrade) {
    await addTradeLeafDemand(supabase, reqMap);
    // Job-attribute demand (e.g. Home/Belt lifts need guide-shoe liners): added
    // even when the BOM sum is empty, so the emptiness check comes AFTER this.
    await addJobDriveDemand(supabase, reqMap, driveByJob);
  }

  if (reqMap.size === 0) return [];

  const itemIds = Array.from(reqMap.keys());

  // Category tree -> resolve each item's TOP-LEVEL category (walk parent_id to the
  // root). Drives the by-category grouping on the Requirements pages. Cheap: the
  // categories table is small, one read.
  const topCatOf = await buildTopCategoryResolver(supabase);

  // Fetch the items (with stock) for the required item ids. The header -> job map
  // was already built up front (and used for the stage scope above). category_id is
  // selected alongside the joined category so we can resolve the top-level parent.
  const allItems: any[] = [];
  {
    const batches = [];
    for (let i = 0; i < itemIds.length; i += 200) {
      batches.push(
        supabase
          .from("items")
          .select(`
            id, code, name, item_type, procurement_type, category_id,
            category:item_categories!items_category_id_fkey(name, procurement_type),
            uom:units_of_measurement(abbreviation),
            inventory(quantity)
          `)
          .in("id", itemIds.slice(i, i + 200)),
      );
    }
    const results = await Promise.all(batches);
    for (const r of results) {
      if (r.error) throw r.error;
      allItems.push(...(r.data ?? []));
    }
  }

  // Outstanding PO qty per item (un-nested read — this fn runs inside the MRP
  // unstable_cache; the cached getOutstandingByItem would nest and break it).
  const onOrder = await _getOutstandingByItemUncached();

  const rows: MrpRow[] = allItems.map((item) => {
    const req = reqMap.get(item.id)!;
    const totalStock = (item.inventory ?? []).reduce(
      (sum: number, inv: { quantity: number }) => sum + Number(inv.quantity),
      0,
    );
    const jobIds = new Set<string>(req.jobIds);
    for (const bid of req.bomIds) {
      const jid = headerToJob.get(bid);
      if (jid) jobIds.add(jid);
    }

    // Effective procurement type: item-level override wins, else
    // inherit from the (sub-)category. Null if neither is set.
    const procurement_type: "make" | "trade" | null =
      (item.procurement_type as "make" | "trade" | null) ??
      ((item.category?.procurement_type ?? null) as
        | "make"
        | "trade"
        | null);

    const shortfall = Math.max(0, req.total - totalStock);
    const on_order = onOrder[item.id] ?? 0;
    return {
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      item_type: item.item_type,
      category_name: item.category?.name ?? null,
      top_category_name: topCatOf(item.category_id ?? null),
      uom_abbreviation: item.uom?.abbreviation ?? null,
      total_required: req.total,
      total_stock: totalStock,
      shortfall,
      on_order,
      to_buy: Math.max(0, shortfall - on_order),
      job_count: jobIds.size,
      procurement_type,
    };
  });

  rows.sort((a, b) => b.shortfall - a.shortfall);
  return rows;
}

/** Effective procurement (item override, else category) for a set of item ids. */
async function effectiveProcurement(
  supabase: ReturnType<typeof createCacheClient>,
  ids: string[],
): Promise<Map<string, "make" | "trade" | null>> {
  const out = new Map<string, "make" | "trade" | null>();
  const batches = [];
  for (let i = 0; i < ids.length; i += 200) {
    batches.push(
      supabase
        .from("items")
        .select("id, procurement_type, category:item_categories!items_category_id_fkey(procurement_type)")
        .in("id", ids.slice(i, i + 200)),
    );
  }
  const results = await Promise.all(batches);
  for (const r of results) {
    if (r.error) throw r.error;
    for (const it of r.data ?? []) {
      const cat = Array.isArray(it.category) ? it.category[0] : it.category;
      out.set(
        it.id as string,
        (it.procurement_type as "make" | "trade" | null) ??
          ((cat?.procurement_type ?? null) as "make" | "trade" | null),
      );
    }
  }
  return out;
}

/**
 * Loads the category tree and returns a resolver that maps an item's (leaf)
 * category_id to its TOP-LEVEL category name (walking parent_id to the root).
 * Cycle-guarded. Returns null for items with no category. Mirrors the topCatOf
 * helper inside getProductionPlan; kept local so the MRP read stays self-contained.
 */
async function buildTopCategoryResolver(
  supabase: ReturnType<typeof createCacheClient>,
): Promise<(catId: string | null) => string | null> {
  const { data, error } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  if (error) throw error;
  const catById = new Map<string, { name: string | null; parent_id: string | null }>();
  for (const c of data ?? [])
    catById.set(c.id as string, {
      name: (c.name as string) ?? null,
      parent_id: (c.parent_id as string | null) ?? null,
    });
  return (catId: string | null): string | null => {
    if (!catId) return null;
    let cid = catId;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cid)) break;
      seen.add(cid);
      const parent = catById.get(cid)?.parent_id;
      if (!parent) break;
      cid = parent;
    }
    return catById.get(cid)?.name ?? null;
  };
}

/**
 * Folds TRADE parts that sit under demanded MAKE items (via item_bom_lines) into
 * `reqMap`, attributed to the parent's jobs. Mutates reqMap in place. Trade leaves
 * only — make sub-assemblies are recursed through but not themselves added (the
 * production plan handles manufacturing). Required-based, representative-child
 * resolution, depth-capped + cycle-guarded. See the call site for the rationale.
 */
async function addTradeLeafDemand(
  supabase: ReturnType<typeof createCacheClient>,
  reqMap: Map<string, ReqEntry>,
): Promise<void> {
  const bomRows = await fetchAllRanged<{ parent_item_id: string; child_item_id: string | null; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("item_bom_lines")
        .select("parent_item_id, child_item_id, qty", withCount ? { count: "exact" } : {})
        .not("child_item_id", "is", null)
        .range(from, to),
  );
  if (bomRows.length === 0) return;

  const bomByParent = new Map<string, { child: string; qty: number }[]>();
  const participantIds = new Set<string>();
  for (const b of bomRows) {
    if (!b.child_item_id) continue;
    participantIds.add(b.parent_item_id);
    participantIds.add(b.child_item_id);
    const arr = bomByParent.get(b.parent_item_id) ?? [];
    arr.push({ child: b.child_item_id, qty: Number(b.qty) || 0 });
    bomByParent.set(b.parent_item_id, arr);
  }

  const effProc = await effectiveProcurement(supabase, [...participantIds]);

  const derived = new Map<string, { total: number; bomIds: Set<string> }>();
  const explode = (itemId: string, qty: number, bomIds: Set<string>, visited: Set<string>, depth: number) => {
    if (qty <= 0 || depth > 12 || visited.has(itemId)) return;
    const lines = bomByParent.get(itemId);
    if (!lines) return;
    const nv = new Set(visited);
    nv.add(itemId);
    for (const ln of lines) {
      const childQty = qty * ln.qty;
      if (childQty <= 0) continue;
      if (effProc.get(ln.child) === "trade") {
        const ex = derived.get(ln.child);
        if (ex) { ex.total += childQty; for (const b of bomIds) ex.bomIds.add(b); }
        else derived.set(ln.child, { total: childQty, bomIds: new Set(bomIds) });
      } else {
        explode(ln.child, childQty, bomIds, nv, depth + 1); // make sub-assembly → keep walking
      }
    }
  };

  for (const [itemId, req] of Array.from(reqMap.entries())) {
    if (!bomByParent.has(itemId)) continue; // no parts list → nothing to explode
    if (effProc.get(itemId) === "trade") continue; // a bought item isn't "made"
    explode(itemId, req.total, req.bomIds, new Set(), 0);
  }

  for (const [leaf, d] of derived) {
    const ex = reqMap.get(leaf);
    if (ex) { ex.total += d.total; for (const b of d.bomIds) ex.bomIds.add(b); }
    else reqMap.set(leaf, { total: d.total, bomIds: new Set(d.bomIds) });
  }
}

/**
 * Folds JOB_DRIVE_DEMAND (parts a lift needs by drive_type, not via the BOM) into
 * `reqMap`. For each rule, qtyPerJob × (in-scope in-production jobs whose drive_type
 * matches) is added to the item's demand, attributed to those jobs (jobIds), so the
 * row's job_count is right. driveByJob already reflects the status/cutoff scope; the
 * owner's rule counts every such in-production job regardless of requirement stage.
 */
async function addJobDriveDemand(
  supabase: ReturnType<typeof createCacheClient>,
  reqMap: Map<string, ReqEntry>,
  driveByJob: Map<string, string | null>,
): Promise<void> {
  if (JOB_DRIVE_DEMAND.length === 0 || driveByJob.size === 0) return;
  const codes = [...new Set(JOB_DRIVE_DEMAND.map((r) => r.code))];
  const { data: items, error } = await supabase.from("items").select("id, code").in("code", codes);
  if (error) throw error;
  const idByCode = new Map<string, string>((items ?? []).map((it) => [it.code as string, it.id as string]));

  for (const rule of JOB_DRIVE_DEMAND) {
    const itemId = idByCode.get(rule.code);
    if (!itemId) continue;
    const jobIds = new Set<string>();
    for (const [jobId, drive] of driveByJob) {
      if (drive && rule.driveTypes.includes(drive)) jobIds.add(jobId);
    }
    if (jobIds.size === 0) continue;
    const total = rule.qtyPerJob * jobIds.size;
    const ex = reqMap.get(itemId);
    if (ex) {
      ex.total += total;
      ex.jobIds = ex.jobIds ?? new Set();
      for (const j of jobIds) ex.jobIds.add(j);
    } else {
      reqMap.set(itemId, { total, bomIds: new Set(), jobIds });
    }
  }
}

/**
 * Folds `item_demand_rules` into reqMap: a child needed `qty` per unit of a demanded
 * PARENT item (e.g. guide shoes per safety frame). Unlike item_bom_lines these are
 * DEMAND-ONLY — the production plan never sees them, so a parent's own cutting
 * program is left intact (a parts list would override it and drop the parent's
 * steel from the buy list). Adds child demand = Σ(parent demand × qty), attributed
 * to the parent's jobs (bomIds) so job_count resolves. The child's own procurement
 * decides which MRP tab it lands in (guide shoes are make → Make MRP).
 */
async function addComponentRuleDemand(
  supabase: ReturnType<typeof createCacheClient>,
  reqMap: Map<string, ReqEntry>,
): Promise<void> {
  const rules = await fetchAllRanged<{ parent_item_id: string; child_item_id: string; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("item_demand_rules")
        .select("parent_item_id, child_item_id, qty", withCount ? { count: "exact" } : {})
        .range(from, to),
  );
  if (rules.length === 0) return;

  // Compute additions off the PARENT demand snapshot (children aren't parents here).
  const add = new Map<string, { total: number; bomIds: Set<string> }>();
  for (const r of rules) {
    const parent = reqMap.get(r.parent_item_id);
    if (!parent || parent.total <= 0) continue;
    const q = Number(r.qty) || 0;
    if (q <= 0) continue;
    const ex = add.get(r.child_item_id) ?? { total: 0, bomIds: new Set<string>() };
    ex.total += parent.total * q;
    for (const b of parent.bomIds) ex.bomIds.add(b);
    add.set(r.child_item_id, ex);
  }
  for (const [child, d] of add) {
    const ex = reqMap.get(child);
    if (ex) { ex.total += d.total; for (const b of d.bomIds) ex.bomIds.add(b); }
    else reqMap.set(child, { total: d.total, bomIds: new Set(d.bomIds) });
  }
}

/**
 * The set of item ids whose job-BOM demand drives demand for `itemId`, each with a
 * multiplier. Always includes {itemId: 1}; adds every assembly that is "built from"
 * `itemId` (directly or transitively, via item_bom_lines), with the product of the
 * qtys along the path (summed across multiple paths). Lets the per-item job
 * breakdown attribute a trade part (e.g. a door shoe) back to the jobs whose made
 * parents (the gates) require it — keeping the popover consistent with getMrpData.
 */
async function computeDemandSources(
  supabase: ReturnType<typeof createCacheClient>,
  itemId: string,
): Promise<Map<string, number>> {
  const sources = new Map<string, number>([[itemId, 1]]);
  const rows = await fetchAllRanged<{ parent_item_id: string; child_item_id: string | null; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("item_bom_lines")
        .select("parent_item_id, child_item_id, qty", withCount ? { count: "exact" } : {})
        .not("child_item_id", "is", null)
        .range(from, to),
  );
  if (rows.length > 0) {
    const parentsOf = new Map<string, { parent: string; qty: number }[]>();
    for (const r of rows) {
      if (!r.child_item_id) continue;
      const arr = parentsOf.get(r.child_item_id) ?? [];
      arr.push({ parent: r.parent_item_id, qty: Number(r.qty) || 0 });
      parentsOf.set(r.child_item_id, arr);
    }
    let frontier: { id: string; mult: number }[] = [{ id: itemId, mult: 1 }];
    for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
      const next: { id: string; mult: number }[] = [];
      for (const { id, mult } of frontier) {
        for (const { parent, qty } of parentsOf.get(id) ?? []) {
          const m = mult * qty;
          if (m <= 0) continue;
          sources.set(parent, (sources.get(parent) ?? 0) + m);
          next.push({ id: parent, mult: m });
        }
      }
      frontier = next;
    }
  }
  // Component-demand-rule parents (e.g. the safety frames that need this guide
  // shoe) — demand-only rules, so the popover lists the contributing frames' jobs.
  const ruleRows = await fetchAllRanged<{ parent_item_id: string; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("item_demand_rules")
        .select("parent_item_id, qty", withCount ? { count: "exact" } : {})
        .eq("child_item_id", itemId)
        .range(from, to),
  );
  for (const r of ruleRows) {
    const m = Number(r.qty) || 0;
    if (m > 0) sources.set(r.parent_item_id, (sources.get(r.parent_item_id) ?? 0) + m);
  }
  return sources;
}

/* ================================================================== */
/*  Multi-level explosion -> raw-material / purchased buy list         */
/*                                                                    */
/*  Walks job demand top-down: each make item explodes through its    */
/*  parts list (item_bom_lines, finish-resolved) and/or the program   */
/*  that cuts it, down to raw sheets + purchased parts. Phantoms are   */
/*  byproducts of a run and never appear as demand, so they drop out   */
/*  naturally. NOTE: nesting/yield optimisation is intentionally NOT   */
/*  solved — sheet demand is rolled up per program at whole runs,      */
/*  which is conservative (never under-orders). Treat as an estimate   */
/*  to validate by hand against one door's program.                   */
/* ================================================================== */

export interface PlanLeaf {
  item_id: string;
  code: string;
  name: string;
  uom: string | null;
  type: string;
  category: string; // top-level category
  subCategory: string; // direct (sub-)category
  qty: number;
  in_stock: number;
  shortfall: number;
}
export interface ProductionPlan {
  cutoffDate: string | null;
  /** Raw sheets / materials to buy (program inputs + un-recipe'd raw items). */
  rawMaterials: PlanLeaf[];
  /** Purchased (trade) parts to buy. */
  purchased: PlanLeaf[];
  /** Make items with no program and no parts list — can't explode (flag). */
  unresolved: { item_id: string; code: string; name: string; qty: number }[];
  /** Program run counts + machine time (for reference / shop scheduling). */
  programRuns: ProgramRunPlan[];
}

export interface ProgramRunPlan {
  program_id: string;
  code: string | null;
  name: string;
  runs: number;
  /** Machining time of ONE run in seconds (null = not captured on the program). */
  machining_time_seconds: number | null;
  /** runs × machining_time_seconds (null when the per-run time is unknown). */
  machine_seconds: number | null;
  /** The program's input sheet (first non-trade input) for per-spec rollups. */
  sheet_code: string | null;
  sheet_name: string | null;
}

export async function getProductionPlan(
  cutoffDate?: string,
): Promise<ProductionPlan> {
  const key = cutoffDate ?? "__all__";
  return unstable_cache(
    _getProductionPlanUncached,
    ["production-plan", key],
    { revalidate: 1800, tags: ["jobs", "bom-lines", "items", "inventory-stock", "operations"] },
  )(cutoffDate);
}

async function _getProductionPlanUncached(
  cutoffDate?: string,
): Promise<ProductionPlan> {
  const supabase = createCacheClient();

  // Top-level demand + every active item (procurement, family/finish, stock).
  // Use the UN-nested variants: this fn is itself wrapped in unstable_cache, and
  // nesting unstable_cache (getMrpData/getItemsWithStock) makes the OUTER
  // production-plan cache degrade to pass-through (re-running on every request).
  const [demand, items] = await Promise.all([
    _getMrpDataUncached(cutoffDate),
    _getItemsWithStockUncached(),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  // These five loads are independent of one another (category tree, program
  // outputs, program inputs, assembly parts lists, program audit status).
  // Fetch them concurrently instead of one after another — same rows, just
  // fewer sequential round-trips.
  const [catData, outRows, inRows, bomRows, opRows] = await Promise.all([
    supabase.from("item_categories").select("id, name, parent_id"),
    // item -> the program that produces it + that output's qty/run. Includes
    // both 'component' outputs (stocked make-items) and 'cut_part' outputs that
    // link to a phantom item, so a phantom loose-part child of an assembly still
    // explodes through the program that cuts it down to its sheet.
    fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("operation_outputs")
        .select("operation_id, item_id, qty_per_run", withCount ? { count: "exact" } : {})
        .in("role", ["component", "cut_part"])
        .not("item_id", "is", null)
        .range(from, to),
    ),
    // program -> its input lines (sheets/bought).
    fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("operation_inputs")
        .select("operation_id, item_id, qty_per_run", withCount ? { count: "exact" } : {})
        .not("item_id", "is", null)
        .range(from, to),
    ),
    // assembly parts lists.
    fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("item_bom_lines")
        .select("parent_item_id, child_item_id, child_family, qty, finish_rule, pinned_finish", withCount ? { count: "exact" } : {})
        .range(from, to),
    ),
    // program audit status — the buy list prefers AUDITED producers.
    fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("operations")
        .select("id, audited_at", withCount ? { count: "exact" } : {})
        .eq("is_active", true)
        .range(from, to),
    ),
  ]);

  // Category tree -> resolve top-level category for buy-list filtering.
  const catById = new Map<string, { name: string | null; parent_id: string | null }>();
  for (const c of catData.data ?? [])
    catById.set(c.id as string, { name: (c.name as string) ?? null, parent_id: (c.parent_id as string | null) ?? null });
  const topCatOf = (catId: string | null | undefined): string => {
    if (!catId) return "(none)";
    let cid: string = catId;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cid)) break;
      seen.add(cid);
      const parent = catById.get(cid)?.parent_id;
      if (!parent) break;
      cid = parent;
    }
    return catById.get(cid)?.name ?? "(none)";
  };

  // item -> producing program. Many items have several producers (328 at last
  // audit), and the previous "first row wins" over an unordered scan made the
  // buy list NONDETERMINISTIC and could pick an unaudited program. Now:
  // audited beats pending, ties broken by lowest operation id — stable across
  // cache refreshes with identical data.
  const auditedOp = new Map<string, boolean>();
  for (const o of opRows) auditedOp.set(o.id as string, o.audited_at != null);
  const itemToProgram = new Map<
    string,
    { programId: string; outQty: number; audited: boolean }
  >();
  for (const o of outRows) {
    if (!auditedOp.has(o.operation_id)) continue; // inactive program
    const cand = {
      programId: o.operation_id as string,
      outQty: Number(o.qty_per_run) || 1,
      audited: auditedOp.get(o.operation_id) === true,
    };
    const cur = itemToProgram.get(o.item_id);
    if (
      !cur ||
      (cand.audited && !cur.audited) ||
      (cand.audited === cur.audited && cand.programId < cur.programId)
    ) {
      itemToProgram.set(o.item_id, cand);
    }
  }

  const programInputs = new Map<string, { item_id: string; qty: number }[]>();
  for (const i of inRows) {
    const arr = programInputs.get(i.operation_id) ?? [];
    arr.push({ item_id: i.item_id, qty: Number(i.qty_per_run) || 0 });
    programInputs.set(i.operation_id, arr);
  }

  const bomByParent = new Map<string, any[]>();
  for (const b of bomRows) {
    const arr = bomByParent.get(b.parent_item_id) ?? [];
    arr.push(b);
    bomByParent.set(b.parent_item_id, arr);
  }

  // family+finish -> item, for inherit/pinned resolution.
  const familyFinishToItem = new Map<string, string>();
  for (const it of items) {
    if (it.family && it.finish) {
      familyFinishToItem.set(`${it.family}|||${it.finish}`, it.id);
    }
  }

  // program-name lookup (only needed for the few programs we actually run).
  const programIdsUsed = new Set<string>();

  const programRuns = new Map<string, number>();
  const purchased = new Map<string, number>();
  const rawLeaf = new Map<string, number>();
  const unresolved = new Map<string, number>();

  const resolveChild = (line: any, parentFinish: string | null): string | null => {
    if (line.finish_rule === "neutral") return line.child_item_id;
    const fam = line.child_family;
    const finish = line.finish_rule === "pinned" ? line.pinned_finish : parentFinish;
    if (fam && finish) {
      const hit = familyFinishToItem.get(`${fam}|||${finish}`);
      if (hit) return hit;
    }
    return line.child_item_id; // fall back to the representative child
  };

  const explode = (
    itemId: string,
    qty: number,
    parentFinish: string | null,
    visited: Set<string>,
    depth: number,
  ): void => {
    const it = itemById.get(itemId);
    if (!it) return; // inactive/unknown — ignore
    if (depth > 12 || visited.has(itemId)) {
      unresolved.set(itemId, (unresolved.get(itemId) ?? 0) + qty);
      return;
    }
    if (it.effective_procurement_type === "trade") {
      purchased.set(itemId, (purchased.get(itemId) ?? 0) + qty);
      return;
    }
    const bom = bomByParent.get(itemId);
    if (bom && bom.length > 0) {
      const nv = new Set(visited);
      nv.add(itemId);
      for (const line of bom) {
        const childId = resolveChild(line, it.finish);
        if (childId) explode(childId, qty * (Number(line.qty) || 0), it.finish, nv, depth + 1);
      }
      return;
    }
    const prog = itemToProgram.get(itemId);
    if (prog) {
      const runs = qty / (prog.outQty || 1);
      programRuns.set(prog.programId, Math.max(programRuns.get(prog.programId) ?? 0, runs));
      programIdsUsed.add(prog.programId);
      return;
    }
    // make/unset with no recipe: raw material -> buy it; otherwise flag.
    if (it.item_type === "raw_material") {
      rawLeaf.set(itemId, (rawLeaf.get(itemId) ?? 0) + qty);
    } else {
      unresolved.set(itemId, (unresolved.get(itemId) ?? 0) + qty);
    }
  };

  for (const d of demand) {
    explode(d.item_id, d.total_required, itemById.get(d.item_id)?.finish ?? null, new Set(), 0);
  }

  // Roll up program input sheets at whole runs.
  const rawDemand = new Map<string, number>(rawLeaf);
  for (const [pid, runs] of programRuns) {
    const wholeRuns = Math.ceil(runs - 1e-9);
    for (const inp of programInputs.get(pid) ?? []) {
      const it = itemById.get(inp.item_id);
      const add = wholeRuns * inp.qty;
      if (it && it.effective_procurement_type === "trade") {
        purchased.set(inp.item_id, (purchased.get(inp.item_id) ?? 0) + add);
      } else {
        rawDemand.set(inp.item_id, (rawDemand.get(inp.item_id) ?? 0) + add);
      }
    }
  }

  const toLeaf = (m: Map<string, number>): PlanLeaf[] =>
    Array.from(m.entries())
      .map(([id, qty]) => {
        const it = itemById.get(id);
        const in_stock = it?.total_stock ?? 0;
        return {
          item_id: id,
          code: it?.code ?? "—",
          name: it?.name ?? "(unknown item)",
          uom: it?.uom?.abbreviation ?? null,
          type: (it?.item_type as string) ?? "—",
          category: topCatOf(it?.category_id),
          subCategory: it?.category?.name ?? "(none)",
          qty,
          in_stock,
          shortfall: Math.max(0, qty - in_stock),
        };
      })
      .sort((a, b) => b.shortfall - a.shortfall);

  // Program names + machining time for the runs list. Disjoint id chunks ->
  // fetch concurrently.
  const usedIds = Array.from(programIdsUsed);
  const progNames = new Map<
    string,
    { code: string | null; name: string; machining_time_seconds: number | null }
  >();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < usedIds.length; i += 200)
      chunks.push(usedIds.slice(i, i + 200));
    const results = await Promise.all(
      chunks.map((ids) =>
        supabase
          .from("operations")
          .select("id, code, name, machining_time_seconds")
          .in("id", ids),
      ),
    );
    for (const { data } of results)
      for (const p of data ?? [])
        progNames.set(p.id, {
          code: p.code ?? null,
          name: p.name,
          machining_time_seconds: p.machining_time_seconds ?? null,
        });
  }

  // A program's "sheet" = its first non-trade input (the raw material it
  // nests on); used by the plan UI to roll machine time up per sheet spec.
  const sheetOf = (pid: string): { code: string | null; name: string | null } => {
    const inputs = programInputs.get(pid) ?? [];
    const pick =
      inputs.find((i) => itemById.get(i.item_id)?.effective_procurement_type !== "trade") ??
      inputs[0];
    const it = pick ? itemById.get(pick.item_id) : null;
    return { code: it?.code ?? null, name: it?.name ?? null };
  };

  return {
    cutoffDate: cutoffDate ?? null,
    rawMaterials: toLeaf(rawDemand),
    purchased: toLeaf(purchased),
    unresolved: Array.from(unresolved.entries())
      .map(([id, qty]) => {
        const it = itemById.get(id);
        return { item_id: id, code: it?.code ?? "—", name: it?.name ?? "(unknown)", qty };
      })
      .sort((a, b) => b.qty - a.qty),
    programRuns: Array.from(programRuns.entries())
      .map(([pid, runs]) => {
        const wholeRuns = Math.ceil(runs - 1e-9);
        const mts = progNames.get(pid)?.machining_time_seconds ?? null;
        const sheet = sheetOf(pid);
        return {
          program_id: pid,
          code: progNames.get(pid)?.code ?? null,
          name: progNames.get(pid)?.name ?? "(program)",
          runs: wholeRuns,
          machining_time_seconds: mts,
          machine_seconds: mts != null ? wholeRuns * mts : null,
          sheet_code: sheet.code,
          sheet_name: sheet.name,
        };
      })
      .sort((a, b) => (b.machine_seconds ?? 0) - (a.machine_seconds ?? 0) || b.runs - a.runs),
  };
}

/* ================================================================== */
/*  Per-item job breakdown (hover popover on MRP table)               */
/* ================================================================== */

export interface MrpJobBreakdown {
  job_id: string;
  job_number: string;
  customer_name: string | null;
  requirement_dispatch_date: string | null;
  /** Number of BOM lines on this job that reference the item. */
  line_count: number;
  /** Sum of required_quantity across those lines. */
  total_quantity: number;
}

/**
 * For a given item, return every job whose BOM has at least one line
 * referencing that item (with required_quantity > 0), along with the
 * per-job count of lines and the sum of required quantities.
 *
 * Honors the same cutoffDate filter as `getMrpData` so the breakdown
 * stays consistent with the table the user is looking at.
 */
export async function getMrpItemJobs(
  itemId: string,
  cutoffDate?: string,
): Promise<MrpJobBreakdown[]> {
  const key = `${itemId}:${cutoffDate ?? "__all__"}`;
  return unstable_cache(
    (id: string, date?: string) => _getMrpItemJobsUncached(id, date),
    ["mrp-item-jobs", key],
    { revalidate: 1800, tags: ["jobs", "bom-lines"] },
  )(itemId, cutoffDate);
}

/** If `itemId` is a JOB_DRIVE_DEMAND item, the matching in-production jobs as a
 *  breakdown (qtyPerJob each); otherwise []. Mirrors getMrpData's drive-demand. */
async function jobDriveBreakdown(
  supabase: ReturnType<typeof createCacheClient>,
  itemId: string,
  cutoffDate?: string,
): Promise<MrpJobBreakdown[]> {
  if (JOB_DRIVE_DEMAND.length === 0) return [];
  const { data: item } = await supabase.from("items").select("code").eq("id", itemId).maybeSingle();
  const code = (item?.code as string | undefined) ?? undefined;
  const rule = code ? JOB_DRIVE_DEMAND.find((r) => r.code === code) : undefined;
  if (!rule) return [];
  const jobs = await fetchAllRanged<{ id: string; job_number: string; customer_name: string | null; requirement_dispatch_date: string | null }>(
    (from, to, withCount) => {
      let q = supabase
        .from("jobs")
        .select("id, job_number, customer_name, requirement_dispatch_date", withCount ? { count: "exact" } : {})
        .eq("status", "in_production")
        .in("drive_type", rule.driveTypes);
      if (cutoffDate) q = q.lte("requirement_dispatch_date", cutoffDate);
      return q.range(from, to);
    },
  );
  return jobs
    .map((j) => ({
      job_id: j.id,
      job_number: j.job_number,
      customer_name: j.customer_name ?? null,
      requirement_dispatch_date: j.requirement_dispatch_date ?? null,
      line_count: 1,
      total_quantity: rule.qtyPerJob,
    }))
    .sort((a, b) => (a.job_number || "").localeCompare(b.job_number || ""));
}

async function _getMrpItemJobsUncached(
  itemId: string,
  cutoffDate?: string,
): Promise<MrpJobBreakdown[]> {
  const supabase = createCacheClient();

  // Job-attribute (drive_type) demand items aren't on any BOM — list their matching
  // in-production jobs directly so the popover matches the table's job count.
  const driveJobs = await jobDriveBreakdown(supabase, itemId, cutoffDate);

  // Demand for `itemId` may come directly (its own job-BOM lines) AND/OR via
  // assemblies that are "built from" it (e.g. a door shoe inside a collapsible
  // gate). `sources` maps every driver item to its multiplier ({itemId:1} for a
  // plain item). Keeps the popover consistent with getMrpData, which folds the
  // same trade-leaf demand into the table.
  const sources = await computeDemandSources(supabase, itemId);
  const sourceIds = [...sources.keys()];

  // 1) Fetch BOM lines referencing ANY source item with qty > 0. `category` lets
  // us apply the same requirement-stage scoping as getMrpData below; `item_id`
  // tells us which source (and thus which multiplier) a line belongs to.
  const allLines = await fetchAllRanged<{
    id: string;
    job_bom_id: string;
    required_quantity: number;
    category: string | null;
    item_id: string;
  }>((from, to, withCount) =>
    supabase
      .from("job_bom_lines")
      .select(
        "id, job_bom_id, required_quantity, category, item_id",
        withCount ? { count: "exact" } : {},
      )
      .in("item_id", sourceIds)
      .gt("required_quantity", 0)
      .range(from, to),
  );
  // No BOM lines reference this item: if it's a job-attribute item, its breakdown
  // is the drive-type job list; otherwise there's nothing to show.
  if (allLines.length === 0) return driveJobs;

  // The dispatched-qty batches and the header->job batches both depend only on
  // `allLines` (not on each other), and the chunks within each are independent.
  // Fire every chunk of both concurrently in one Promise.all, then fold the
  // results. Same rows, same accumulation — purely fewer sequential round-trips.
  const lineIds = allLines.map((l) => l.id);
  const headerIds = Array.from(new Set(allLines.map((l) => l.job_bom_id)));

  const dispatchChunks: string[][] = [];
  for (let i = 0; i < lineIds.length; i += 200)
    dispatchChunks.push(lineIds.slice(i, i + 200));
  const headerChunks: string[][] = [];
  for (let i = 0; i < headerIds.length; i += 200)
    headerChunks.push(headerIds.slice(i, i + 200));

  const [dispatchResults, headerResults] = await Promise.all([
    Promise.all(
      dispatchChunks.map((ids) =>
        supabase
          .from("job_dispatch_lines")
          .select("job_bom_line_id, qty")
          .in("job_bom_line_id", ids),
      ),
    ),
    Promise.all(
      headerChunks.map((ids) =>
        supabase.from("job_bom_headers").select("id, job_id").in("id", ids),
      ),
    ),
  ]);

  // Net out dispatched qty per BOM line (any phase), same as getMrpData, so a
  // fully-dispatched job stops appearing for this item and partials show only
  // the remaining qty.
  const dispatchedByLine = new Map<string, number>();
  for (const { data, error } of dispatchResults) {
    if (error) throw error;
    for (const d of data ?? []) {
      const lid = d.job_bom_line_id as string;
      dispatchedByLine.set(lid, (dispatchedByLine.get(lid) ?? 0) + (Number(d.qty) || 0));
    }
  }

  // 2) Resolve BOM headers → job_id (in batches).
  const headerToJob = new Map<string, string>();
  for (const { data, error } of headerResults) {
    if (error) throw error;
    for (const h of data ?? []) headerToJob.set(h.id, h.job_id);
  }

  // 3) Fetch job metadata FIRST — the popover must tell the same story as the
  // table, so it applies getMrpData's exact job filters: status=in_production
  // and (optionally) the dispatch-date cutoff. requirement_stage comes along
  // for the stage scoping below.
  const candidateJobIds = Array.from(new Set(headerToJob.values()));
  const jobMeta = new Map<
    string,
    {
      job_number: string;
      customer_name: string | null;
      requirement_dispatch_date: string | null;
      requirement_stage: string;
    }
  >();
  {
    const jobChunks: string[][] = [];
    for (let i = 0; i < candidateJobIds.length; i += 200)
      jobChunks.push(candidateJobIds.slice(i, i + 200));
    const jobResults = await Promise.all(
      jobChunks.map((ids) => {
        let q = supabase
          .from("jobs")
          .select(
            "id, job_number, customer_name, requirement_dispatch_date, requirement_stage",
          )
          .in("id", ids)
          .eq("status", "in_production");
        if (cutoffDate) q = q.lte("requirement_dispatch_date", cutoffDate);
        return q;
      }),
    );
    for (const { data, error } of jobResults) {
      if (error) throw error;
      for (const job of data ?? [])
        jobMeta.set(job.id as string, {
          job_number: job.job_number as string,
          customer_name: (job.customer_name as string | null) ?? null,
          requirement_dispatch_date:
            (job.requirement_dispatch_date as string | null) ?? null,
          requirement_stage:
            (job.requirement_stage as string | null) ?? "new",
        });
    }
  }
  if (jobMeta.size === 0) return [];

  // 4) Aggregate per job — same demand rules as getMrpData: only qualifying
  // jobs; "new" requirement contributes nothing; "first_phase" counts only
  // first-phase sections; dispatched qty netted out per line.
  const byJob = new Map<
    string,
    { line_count: number; total_quantity: number }
  >();
  for (const line of allLines) {
    const jobId = headerToJob.get(line.job_bom_id);
    if (!jobId) continue;
    const meta = jobMeta.get(jobId);
    if (!meta) continue; // not in production / outside the date range
    const stage = meta.requirement_stage;
    if (stage === "new") continue;
    if (
      stage === "first_phase" &&
      dispatchPhaseOf((line.category as string) ?? "") !== "first"
    )
      continue;
    // net is in the SOURCE item's units; the multiplier converts it to `itemId`
    // units (e.g. gates remaining × 15 shoes/gate). Dispatch is netted on the
    // source line, matching how getMrpData folds the derived demand.
    const mult = sources.get(line.item_id) ?? 1;
    const net =
      Math.max(
        0,
        (Number(line.required_quantity) || 0) - (dispatchedByLine.get(line.id) ?? 0),
      ) * mult;
    if (net <= 0) continue; // fully dispatched on this line
    const agg = byJob.get(jobId) ?? { line_count: 0, total_quantity: 0 };
    agg.line_count += 1;
    agg.total_quantity += net;
    byJob.set(jobId, agg);
  }
  if (byJob.size === 0) return [];

  // 5) Merge and return, sorted by largest contribution first.
  const out: MrpJobBreakdown[] = Array.from(byJob.entries()).map(
    ([jobId, agg]) => {
      const meta = jobMeta.get(jobId)!;
      return {
        job_id: jobId,
        job_number: meta.job_number,
        customer_name: meta.customer_name,
        requirement_dispatch_date: meta.requirement_dispatch_date,
        line_count: agg.line_count,
        total_quantity: agg.total_quantity,
      };
    },
  );
  out.sort((a, b) => b.line_count - a.line_count);
  return out;
}
