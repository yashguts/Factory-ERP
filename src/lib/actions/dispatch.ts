"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { dispatchPhaseOf, type DispatchPhase } from "@/lib/bom/bom-sections";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { recordTransaction } from "@/lib/actions/inventory";

/* ------------------------------------------------------------------ *
 * Job dispatch.
 *
 * A job ships in one or more dispatches over time: first phase early,
 * second phase later, sometimes partial quantities, sometimes the whole
 * job at once. Each dispatch is a dated event with line items; the actual
 * item/qty sent can differ from the job's BOM, so dispatch lines are
 * editable and tracked independently. "Remaining" per BOM line =
 * required − sum(all dispatched against that line).
 *
 * Phase 0: NO inventory effect (stock is managed by another team). We only
 * record what went out. Inventory deduction can be layered on later.
 * ------------------------------------------------------------------ */

export type PhaseScope = "first" | "second" | "full";

function flatten<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

/* ------------------------------------------------------------------ *
 * Inventory deduction on dispatch (owner-enabled 2026-06-17, replacing the
 * earlier "dispatch ≠ inventory" rule). FORWARD-ONLY: only dispatches created
 * after this shipped post stock — the 43 historical dispatches are never touched.
 * Idempotent: posting is keyed by reference_type='dispatch' + reference_id, so a
 * re-run is a no-op; undo posts a 'dispatch_undo' adjustment that restores stock,
 * guarded against double-reversal. Negative stock is allowed (a real signal).
 * ------------------------------------------------------------------ */

type Db = Awaited<ReturnType<typeof createClient>>;

/** Warehouse ids by the three known store names. */
async function resolveStores(supabase: Db): Promise<{ finished: string | null; main: string | null; raw: string | null }> {
  const { data } = await supabase.from("warehouses").select("id, name");
  const byName = new Map((data ?? []).map((w: any) => [w.name as string, w.id as string]));
  return {
    finished: byName.get("Finished Goods") ?? null,
    main: byName.get("Main Store") ?? null,
    raw: byName.get("Raw Material Store") ?? null,
  };
}

/** Post a stock-OUT for each dispatched line, from the warehouse the item is
 *  actually stocked in (prefer Finished Goods → Main Store → Raw → default
 *  Finished Goods, letting it go negative). No-op if already posted. */
async function postDispatchInventory(supabase: Db, dispatchId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("inventory_transactions")
    .select("id")
    .eq("reference_type", "dispatch")
    .eq("reference_id", dispatchId)
    .limit(1);
  if (existing && existing.length > 0) return; // already posted

  const { data: lines } = await supabase
    .from("job_dispatch_lines")
    .select("item_id, qty")
    .eq("dispatch_id", dispatchId)
    .not("item_id", "is", null);
  const items = (lines ?? []).filter((l: any) => l.item_id && Number(l.qty) > 0);
  if (items.length === 0) return;

  const stores = await resolveStores(supabase);
  const itemIds = [...new Set(items.map((l: any) => l.item_id as string))];
  const { data: inv } = await supabase
    .from("inventory")
    .select("item_id, warehouse_id, quantity")
    .in("item_id", itemIds);
  const byItem = new Map<string, { warehouse_id: string; quantity: number }[]>();
  for (const r of inv ?? []) {
    const arr = byItem.get(r.item_id as string) ?? [];
    arr.push({ warehouse_id: r.warehouse_id as string, quantity: Number(r.quantity) });
    byItem.set(r.item_id as string, arr);
  }
  const pref = (w: string) => (w === stores.finished ? 3 : w === stores.main ? 2 : w === stores.raw ? 1 : 0);
  const fallback = stores.finished ?? stores.main ?? stores.raw;
  const pickWarehouse = (itemId: string): string | null => {
    const rows = byItem.get(itemId) ?? [];
    const withStock = rows.filter((r) => r.quantity > 0);
    const pool = withStock.length ? withStock : rows;
    if (pool.length === 0) return fallback;
    pool.sort((a, b) => pref(b.warehouse_id) - pref(a.warehouse_id) || b.quantity - a.quantity);
    return pool[0].warehouse_id;
  };

  // Aggregate qty per (item, warehouse) so several lines for one item post once.
  const agg = new Map<string, { item_id: string; warehouse_id: string; qty: number }>();
  for (const l of items) {
    const wid = pickWarehouse(l.item_id as string);
    if (!wid) continue;
    const key = `${l.item_id}|${wid}`;
    const ex = agg.get(key) ?? { item_id: l.item_id as string, warehouse_id: wid, qty: 0 };
    ex.qty += Number(l.qty);
    agg.set(key, ex);
  }
  for (const a of agg.values()) {
    await recordTransaction({
      item_id: a.item_id,
      warehouse_id: a.warehouse_id,
      transaction_type: "dispatch_out",
      quantity: a.qty,
      reference_type: "dispatch",
      reference_id: dispatchId,
      notes: "Dispatched",
    });
  }
}

/** Reverse a dispatch's stock deductions (undo). No-op if already reversed. */
async function reverseDispatchInventory(supabase: Db, dispatchId: string): Promise<void> {
  const { data: undone } = await supabase
    .from("inventory_transactions")
    .select("id")
    .eq("reference_type", "dispatch_undo")
    .eq("reference_id", dispatchId)
    .limit(1);
  if (undone && undone.length > 0) return; // already reversed

  const { data: posts } = await supabase
    .from("inventory_transactions")
    .select("item_id, warehouse_id, quantity")
    .eq("reference_type", "dispatch")
    .eq("reference_id", dispatchId);
  for (const p of posts ?? []) {
    await recordTransaction({
      item_id: p.item_id as string,
      warehouse_id: p.warehouse_id as string,
      transaction_type: "adjustment",
      quantity: Math.abs(Number(p.quantity)), // dispatch_out removed this; add it back
      reference_type: "dispatch_undo",
      reference_id: dispatchId,
      notes: "Dispatch undone — stock restored",
    });
  }
}

/** A job BOM line with its running dispatch state (for the dispatch picker). */
export interface DispatchSummaryLine {
  job_bom_line_id: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
  category: string;
  phase: DispatchPhase;
  required: number;
  dispatched: number; // cumulative across all prior dispatches
  remaining: number;
}

export interface DispatchHistoryLine {
  id: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  label: string | null;
  category: string | null;
  phase: DispatchPhase;
  qty: number;
  /** True when this line was not tied to a BOM line (added at dispatch time). */
  adhoc: boolean;
}

export interface DispatchHistory {
  id: string;
  dispatch_date: string;
  phase_scope: PhaseScope;
  note: string | null;
  created_at: string;
  lines: DispatchHistoryLine[];
}

export interface JobDispatchSummary {
  lines: DispatchSummaryLine[];
  dispatches: DispatchHistory[];
}

export async function getJobDispatchSummary(jobId: string): Promise<JobDispatchSummary> {
  // Cached — job detail (a hot page) reads this. Correctness comes from the
  // jobs/bom-lines tags that every dispatch mutation already revalidates, so
  // the numbers are always fresh after a dispatch.
  return unstable_cache(_getJobDispatchSummaryUncached, ["job-dispatch-summary", jobId], {
    revalidate: 600,
    tags: ["jobs", "bom-lines"],
  })(jobId);
}

async function _getJobDispatchSummaryUncached(
  jobId: string,
): Promise<JobDispatchSummary> {
  const supabase = createCacheClient();

  // BOM lines (item-based, real sections) for the job.
  const { data: header } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .maybeSingle();

  let lines: DispatchSummaryLine[] = [];
  if (header) {
    const { data: bl, error } = await supabase
      .from("job_bom_lines")
      .select(
        `id, category, required_quantity, item_id,
         item:items!job_bom_lines_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
      )
      .eq("job_bom_id", header.id)
      .not("category", "is", null)
      .order("sort_order");
    if (error) throw error;
    lines = (bl ?? []).map((r: any) => {
      const it = flatten<any>(r.item);
      const uom = it ? flatten<any>(it.uom) : null;
      const category = (r.category as string) ?? "";
      const required = Number(r.required_quantity ?? 0);
      return {
        job_bom_line_id: r.id as string,
        item_id: (r.item_id as string | null) ?? null,
        item_code: (it?.code as string) ?? null,
        item_name: (it?.name as string) ?? null,
        uom: (uom?.abbreviation as string) ?? null,
        category,
        phase: dispatchPhaseOf(category),
        required,
        dispatched: 0,
        remaining: required,
      };
    });
  }

  // Dispatch events + their lines.
  const { data: disp } = await supabase
    .from("job_dispatches")
    .select("id, dispatch_date, phase_scope, note, created_at")
    .eq("job_id", jobId)
    .order("dispatch_date", { ascending: false })
    .order("created_at", { ascending: false });
  const dispatchIds = (disp ?? []).map((d: any) => d.id as string);

  let dlines: any[] = [];
  if (dispatchIds.length > 0) {
    const { data: dl } = await supabase
      .from("job_dispatch_lines")
      .select(
        `id, dispatch_id, job_bom_line_id, item_id, category, label, qty,
         item:items!job_dispatch_lines_item_id_fkey(code, name)`,
      )
      .in("dispatch_id", dispatchIds);
    dlines = dl ?? [];
  }

  // Cumulative dispatched per BOM line → fill remaining.
  const byLine = new Map<string, number>();
  for (const d of dlines) {
    if (d.job_bom_line_id)
      byLine.set(
        d.job_bom_line_id,
        (byLine.get(d.job_bom_line_id) ?? 0) + Number(d.qty),
      );
  }
  for (const ln of lines) {
    ln.dispatched = byLine.get(ln.job_bom_line_id) ?? 0;
    ln.remaining = Math.max(0, ln.required - ln.dispatched);
  }

  // History, grouped by dispatch.
  const linesByDispatch = new Map<string, DispatchHistoryLine[]>();
  for (const d of dlines) {
    const it = flatten<any>(d.item);
    const cat = (d.category as string | null) ?? null;
    const arr = linesByDispatch.get(d.dispatch_id) ?? [];
    arr.push({
      id: d.id as string,
      item_id: (d.item_id as string | null) ?? null,
      item_code: (it?.code as string) ?? null,
      item_name: (it?.name as string) ?? null,
      label: (d.label as string | null) ?? null,
      category: cat,
      phase: dispatchPhaseOf(cat ?? ""),
      qty: Number(d.qty),
      adhoc: !d.job_bom_line_id,
    });
    linesByDispatch.set(d.dispatch_id, arr);
  }

  const dispatches: DispatchHistory[] = (disp ?? []).map((d: any) => ({
    id: d.id as string,
    dispatch_date: d.dispatch_date as string,
    phase_scope: d.phase_scope as PhaseScope,
    note: (d.note as string | null) ?? null,
    created_at: d.created_at as string,
    lines: linesByDispatch.get(d.id) ?? [],
  }));

  return { lines, dispatches };
}

export type DispatchSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface DispatchLineInput {
  job_bom_line_id: string | null;
  item_id: string | null;
  category: string | null;
  label?: string | null;
  qty: number;
  /**
   * When set, the BOM line's required_quantity is REVISED to this value (a true
   * correction — "we only ever needed 7, not 10"), so the dropped amount leaves
   * MRP. Left undefined for an ordinary partial dispatch, where the un-sent
   * balance stays required. Only meaningful for real BOM lines (job_bom_line_id).
   */
  revised_required?: number | null;
  /**
   * For an AD-HOC item (no job_bom_line_id): the TOTAL needed for this job. When
   * given, the item is added to the job's BOM with this requirement and this
   * dispatch links to it — so the un-sent balance (needed − qty) is tracked as
   * "due" on later dispatches and in MRP. Omitted = a one-off, not tracked.
   */
  required?: number | null;
}

export async function createDispatch(input: {
  job_id: string;
  dispatch_date: string;
  phase_scope: PhaseScope;
  note?: string | null;
  lines: DispatchLineInput[];
}): Promise<DispatchSaveResult> {
  if (!input.job_id) return { ok: false, error: "Missing job." };
  if (!input.dispatch_date)
    return { ok: false, error: "Pick a dispatch date." };

  // Lines actually being dispatched (qty > 0). A qty-0 line ships nothing but may
  // still carry a requirement revision (the "0 — not required at all" case).
  const dispatchLines = (input.lines ?? []).filter(
    (l) => Number(l.qty) > 0 && (l.item_id || (l.label && l.label.trim())),
  );
  // Requirement revisions come from BOTH partial dispatches ("the rest isn't
  // needed") and qty-0 "not required" lines — read from the FULL input so a 0-qty
  // revise still applies even though nothing ships.
  const revisions = (input.lines ?? []).filter(
    (l) => l.job_bom_line_id && l.revised_required != null && Number.isFinite(l.revised_required as number),
  );
  if (dispatchLines.length === 0 && revisions.length === 0)
    return {
      ok: false,
      error: "Add at least one item to dispatch, or mark one as not required.",
    };

  const supabase = await createClient();

  // Create a dispatch EVENT only when something is actually going out.
  let dispatchId: string | null = null;
  if (dispatchLines.length > 0) {
    const { data: head, error: he } = await supabase
      .from("job_dispatches")
      .insert({
        job_id: input.job_id,
        dispatch_date: input.dispatch_date,
        phase_scope: input.phase_scope,
        note: input.note?.trim() || null,
      })
      .select("id")
      .single();
    if (he) return { ok: false, error: he.message };

    // Ad-hoc items given a "needed" total become TRACKED: add them to the job's
    // BOM (required = needed) and link this dispatch to them, so the un-sent
    // balance shows as due later. Done before building the dispatch rows so they
    // carry the new job_bom_line_id. Best-effort — a hiccup here must not lose the
    // dispatch (the line just stays a plain ad-hoc one).
    const trackable = dispatchLines.filter(
      (l) => !l.job_bom_line_id && l.item_id && l.required != null && Number(l.required) > 0,
    );
    if (trackable.length > 0) {
      try {
        let { data: hdr } = await supabase
          .from("job_bom_headers")
          .select("id")
          .eq("job_id", input.job_id)
          .limit(1)
          .maybeSingle();
        if (!hdr) {
          const { data: created } = await supabase
            .from("job_bom_headers")
            .insert({ job_id: input.job_id })
            .select("id")
            .single();
          hdr = created ?? null;
        }
        if (hdr) {
          for (const l of trackable) {
            const cat = l.category?.trim() || "Additional Items";
            const { data: bl } = await supabase
              .from("job_bom_lines")
              .insert({
                job_bom_id: (hdr as { id: string }).id,
                category: cat,
                item_id: l.item_id,
                required_quantity: Math.max(Number(l.required), Number(l.qty)),
                sort_order: 9999,
              })
              .select("id")
              .single();
            if (bl) {
              l.job_bom_line_id = (bl as { id: string }).id;
              l.category = cat;
            }
          }
        }
      } catch (e) {
        console.error("dispatch: tracking ad-hoc items failed", e);
      }
    }

    const rows = dispatchLines.map((l) => ({
      dispatch_id: head.id as string,
      job_bom_line_id: l.job_bom_line_id ?? null,
      item_id: l.item_id ?? null,
      category: l.category ?? null,
      label: l.label?.trim() || null,
      qty: Number(l.qty),
    }));
    const { error: le } = await supabase.from("job_dispatch_lines").insert(rows);
    if (le) {
      // Best-effort rollback so we never leave an empty dispatch header behind.
      await supabase.from("job_dispatches").delete().eq("id", head.id);
      return { ok: false, error: le.message };
    }
    dispatchId = head.id as string;
  }

  // Apply requirement revisions: a partial "rest not needed", or a qty-0 "not
  // required" → required lowered to the already-provided amount (0 if nothing was
  // ever dispatched), so the dropped balance leaves MRP. Best-effort.
  if (revisions.length > 0) {
    await Promise.all(
      revisions.map((l) =>
        supabase
          .from("job_bom_lines")
          .update({ required_quantity: Math.max(0, Number(l.revised_required)) })
          .eq("id", l.job_bom_line_id as string),
      ),
    );
  }

  // Stage advance + stock deduction happen ONLY when something was actually
  // dispatched (a pure requirement revision changes neither).
  if (dispatchId) {
    const rank = (s: string | null | undefined) =>
      s === "full_material" ? 2 : s === "first_phase" ? 1 : 0;
    const target = input.phase_scope === "first" ? "first_phase" : "full_material";
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("stage")
      .eq("id", input.job_id)
      .maybeSingle();
    if (rank(target) > rank(jobRow?.stage as string | null)) {
      await supabase.from("jobs").update({ stage: target }).eq("id", input.job_id);
    }
    // Deduct dispatched items from stock (forward-only, idempotent, best-effort).
    try {
      await postDispatchInventory(supabase, dispatchId);
    } catch (e) {
      console.error("dispatch inventory post failed", dispatchId, e);
    }
  }

  // A dispatch (netting) OR a requirement revision both change MRP demand — refresh.
  revalidateTag("bom-lines");
  revalidateTag("jobs");
  revalidatePath(`/jobs/${input.job_id}`);
  revalidatePath("/jobs");
  revalidatePath("/mrp");
  return { ok: true, id: dispatchId ?? "" };
}

export async function deleteDispatch(
  dispatchId: string,
  jobId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!dispatchId) return { ok: false, error: "Missing dispatch id." };
  const supabase = await createClient();
  // Restore the stock this dispatch deducted BEFORE deleting it (the reversal
  // reads the dispatch's inventory transactions by reference_id; they survive the
  // delete, but we reverse first so a failure leaves the dispatch intact). Idempotent.
  try {
    await reverseDispatchInventory(supabase, dispatchId);
  } catch (e) {
    console.error("dispatch inventory reversal failed", dispatchId, e);
  }
  const { error } = await supabase
    .from("job_dispatches")
    .delete()
    .eq("id", dispatchId);
  if (error) return { ok: false, error: error.message };
  // Un-dispatching restores demand to MRP — bust the same caches.
  revalidateTag("bom-lines");
  revalidateTag("jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/mrp");
  return { ok: true };
}

export type DispatchStatus = "none" | "partial" | "full";

/** Per-job dispatch status for the jobs list (none / partial / full). */
export async function getJobsDispatchStatus(
  jobIds: string[],
): Promise<Record<string, DispatchStatus>> {
  if (jobIds.length === 0) return {};
  // Cached on the jobs list (hot). Key by the sorted id set; tags bust on any
  // dispatch change so badges stay correct.
  const key = [...jobIds].sort().join(",");
  return unstable_cache(_getJobsDispatchStatusUncached, ["jobs-dispatch-status", key], {
    revalidate: 600,
    tags: ["jobs", "bom-lines"],
  })(jobIds);
}

async function _getJobsDispatchStatusUncached(
  jobIds: string[],
): Promise<Record<string, DispatchStatus>> {
  const out: Record<string, DispatchStatus> = {};
  for (const id of jobIds) out[id] = "none";
  if (jobIds.length === 0) return out;

  const supabase = createCacheClient();
  const { data: disp } = await supabase
    .from("job_dispatches")
    .select("id, job_id")
    .in("job_id", jobIds);
  if (!disp || disp.length === 0) return out;

  const dispJobIds = [...new Set(disp.map((d: any) => d.job_id as string))];
  const dispIds = disp.map((d: any) => d.id as string);

  const { data: headers } = await supabase
    .from("job_bom_headers")
    .select("id, job_id")
    .in("job_id", dispJobIds);
  const headerToJob = new Map(
    (headers ?? []).map((h: any) => [h.id as string, h.job_id as string]),
  );
  const headerIds = (headers ?? []).map((h: any) => h.id as string);

  // Page this read: across many dispatched jobs the BOM-line total can exceed the
  // 1000-row PostgREST cap, which silently truncated the set and made jobs whose
  // un-dispatched lines fell past the cutoff look fully dispatched (CLAUDE.md §8).
  const bl =
    headerIds.length > 0
      ? await fetchAllRanged<{ id: string; job_bom_id: string; required_quantity: number }>(
          (from, to, withCount) =>
            supabase
              .from("job_bom_lines")
              .select("id, job_bom_id, required_quantity", withCount ? { count: "exact" } : {})
              .in("job_bom_id", headerIds)
              .not("category", "is", null)
              .order("id")
              .range(from, to),
        )
      : [];

  const requiredByLine = new Map<string, number>();
  const linesByJob = new Map<string, string[]>();
  for (const l of bl) {
    const job = headerToJob.get(l.job_bom_id as string);
    if (!job) continue;
    requiredByLine.set(l.id as string, Number(l.required_quantity ?? 0));
    const arr = linesByJob.get(job) ?? [];
    arr.push(l.id as string);
    linesByJob.set(job, arr);
  }

  // Page this read too — dispatch lines climb past 1000 as more jobs ship.
  const dl = await fetchAllRanged<{ job_bom_line_id: string | null; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("job_dispatch_lines")
        .select("job_bom_line_id, qty", withCount ? { count: "exact" } : {})
        .in("dispatch_id", dispIds)
        .order("id")
        .range(from, to),
  );
  const dispatchedByLine = new Map<string, number>();
  for (const d of dl) {
    if (d.job_bom_line_id)
      dispatchedByLine.set(
        d.job_bom_line_id as string,
        (dispatchedByLine.get(d.job_bom_line_id as string) ?? 0) +
          Number(d.qty),
      );
  }

  for (const job of dispJobIds) {
    const lineIds = linesByJob.get(job) ?? [];
    if (lineIds.length === 0) {
      out[job] = "partial"; // dispatched, but no BOM to measure completeness
      continue;
    }
    const open = lineIds.some(
      (id) =>
        (requiredByLine.get(id) ?? 0) - (dispatchedByLine.get(id) ?? 0) >
        0.0001,
    );
    out[job] = open ? "partial" : "full";
  }
  return out;
}
