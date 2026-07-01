"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath } from "next/cache";
import { recordTransaction } from "@/lib/actions/inventory";
import { CUTOVER_DATE } from "@/lib/inventory/cutover";
import type { TransactionType } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * Daily Program Runs — the factory's logbook of which programs actually
 * ran on a given day. One row per (program, day) with a run count.
 *
 * Inventory (owner-enabled 2026-06-17): a logged run now CONSUMES its input
 * sheets (production_out from Raw Material Store) and PRODUCES its component
 * outputs (production_in to Main Store), scaled by the run count. FORWARD-ONLY:
 * the 06-15 manual batch used reference_id=NULL, so it never collides; edits/
 * deletes only post for runs THIS system already posted (a legacy run with no
 * reference_id=run_id txn is left untouched). Stocked outputs (component parts
 * AND cut_part child parts reclassified to 'stocked') post; non-stocked phantoms,
 * tooling, scrap and unmapped (null item_id) lines are skipped.
 * ------------------------------------------------------------------ */

function flatten<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function resolveStores(supabase: Db): Promise<{ main: string | null; raw: string | null }> {
  const { data } = await supabase.from("warehouses").select("id, name");
  const byName = new Map((data ?? []).map((w: any) => [w.name as string, w.id as string]));
  return { main: byName.get("Main Store") ?? null, raw: byName.get("Raw Material Store") ?? null };
}

/** True when this run already has system-posted inventory (reference_id=run_id). */
async function runHasInventory(supabase: Db, runId: string): Promise<boolean> {
  const { data } = await supabase
    .from("inventory_transactions")
    .select("id")
    .eq("reference_type", "program_run")
    .eq("reference_id", runId)
    .limit(1);
  return !!(data && data.length);
}

/**
 * Reconcile a run's inventory to `count` runs by posting only the DELTA vs what
 * this run has already posted — correct for record (applied=0 → fresh
 * production_in/out), count-edit (→ adjustment delta) and delete (count=0 →
 * restore). Inputs consume from Raw Material Store, component outputs produce
 * into Main Store. Idempotent (a no-op when already in sync).
 */
async function syncRunInventory(supabase: Db, runId: string, count: number): Promise<void> {
  const { data: run } = await supabase
    .from("operation_runs")
    .select("operation_id, run_date")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return;
  // Cutover: a run dated before the go-live baseline never touches stock (it's
  // already reflected). Return BEFORE reading/reconciling so an existing
  // pre-cutover run's baseline postings are never disturbed on edit/delete.
  if ((run.run_date as string) < CUTOVER_DATE) return;
  const operationId = run.operation_id as string;
  const stores = await resolveStores(supabase);
  if (!stores.raw || !stores.main) return;

  const [{ data: ins }, { data: rawOuts }] = await Promise.all([
    supabase.from("operation_inputs").select("item_id, qty_per_run").eq("operation_id", operationId).not("item_id", "is", null),
    supabase.from("operation_outputs").select("item_id, qty_per_run").eq("operation_id", operationId).in("role", ["component", "cut_part"]).not("item_id", "is", null),
  ]);

  // Only STOCKED outputs post to Main Store. `component` outputs are stocked by
  // definition; `cut_part` (loose child parts) now post too, once reclassified to
  // 'stocked' (Child Parts / Stage 1) — this is what makes cut pieces accumulate
  // stock as programs run. Non-stocked phantoms, tooling and scrap stay skipped.
  const outItemIds = [...new Set((rawOuts ?? []).map((o) => o.item_id as string))];
  const stocked = new Set<string>();
  if (outItemIds.length) {
    const { data: si } = await supabase.from("items").select("id, stock_behaviour").in("id", outItemIds);
    for (const it of si ?? []) if ((it.stock_behaviour as string) === "stocked") stocked.add(it.id as string);
  }
  const outs = (rawOuts ?? []).filter((o) => stocked.has(o.item_id as string));

  // Desired signed net per `${item}|${warehouse}`.
  const desired = new Map<string, { item_id: string; warehouse_id: string; net: number }>();
  const addDesired = (item: string, wh: string, net: number) => {
    const key = `${item}|${wh}`;
    const ex = desired.get(key) ?? { item_id: item, warehouse_id: wh, net: 0 };
    ex.net += net;
    desired.set(key, ex);
  };
  for (const i of ins ?? []) addDesired(i.item_id as string, stores.raw, -(Number(i.qty_per_run) || 0) * count);
  for (const o of outs ?? []) addDesired(o.item_id as string, stores.main, +(Number(o.qty_per_run) || 0) * count);

  // Already-applied net per key from this run's prior program_run txns.
  const { data: posted } = await supabase
    .from("inventory_transactions")
    .select("item_id, warehouse_id, quantity, transaction_type")
    .eq("reference_type", "program_run")
    .eq("reference_id", runId);
  const applied = new Map<string, number>();
  const existingKeys = new Set<string>();
  for (const p of posted ?? []) {
    const key = `${p.item_id}|${p.warehouse_id}`;
    existingKeys.add(key);
    const q = Number(p.quantity) || 0;
    const type = p.transaction_type as string;
    const d = type === "adjustment" ? q : type === "production_in" || type === "purchase_in" || type === "transfer" ? Math.abs(q) : -Math.abs(q);
    applied.set(key, (applied.get(key) ?? 0) + d);
  }

  for (const key of new Set<string>([...desired.keys(), ...existingKeys])) {
    const d = desired.get(key);
    const [keyItem, keyWh] = key.split("|");
    const delta = (d?.net ?? 0) - (applied.get(key) ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    let type: TransactionType;
    let qty: number;
    if (existingKeys.has(key)) {
      type = "adjustment";
      qty = delta;
    } else if (delta > 0) {
      type = "production_in";
      qty = delta;
    } else {
      type = "production_out";
      qty = -delta;
    }
    await recordTransaction({
      item_id: d?.item_id ?? keyItem,
      warehouse_id: d?.warehouse_id ?? keyWh,
      transaction_type: type,
      quantity: qty,
      reference_type: "program_run",
      reference_id: runId,
      notes: count === 0 ? "Program run removed — stock restored" : "Program run posted to stock",
    });
  }
}

export interface RunOutput {
  code: string | null;
  name: string;
  /** Units produced per ONE run (qty_per_run); the row multiplies by runs_count. */
  perRun: number;
  /** 'component' = stocked item, posts to Main Store; 'cut_part' = loose phantom
   *  child (cut & fitted, never stocked); 'tooling' = jig/template. Only
   *  'component' affects inventory — the others are shown for completeness. */
  role: "component" | "cut_part" | "tooling";
}

export interface RunInput {
  code: string | null;
  name: string;
  /** Units (usually sheets) consumed per ONE run; the row multiplies by runs_count. */
  perRun: number;
}

export interface DailyRunRow {
  id: string;
  operation_id: string;
  code: string | null;
  name: string;
  machine: string;
  machining_time_seconds: number | null;
  run_date: string;
  runs_count: number;
  note: string | null;
  created_at: string;
  /** All produced parts: stocked components (post to Main Store) PLUS loose
   *  cut-parts and tooling (shown for completeness — they don't hit inventory).
   *  scrap is excluded. perRun × runs_count = units produced. */
  outputs: RunOutput[];
  /** Raw inputs consumed (the sheets/material the program nests on). perRun ×
   *  runs_count = units drawn from Raw Material Store. */
  inputs: RunInput[];
}

export async function getRunsForDate(date: string): Promise<DailyRunRow[]> {
  if (!date) return [];
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("operation_runs")
    .select(
      `id, operation_id, run_date, runs_count, note, created_at,
       operation:operations(code, name, machine, machining_time_seconds)`,
    )
    .eq("run_date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const runs = data ?? [];

  // Per-program inputs (sheets consumed → Raw Material Store) and outputs (parts
  // produced). One read each for the day's programs, then resolve item names in
  // a single shared lookup.
  const opIds = [...new Set(runs.map((r: any) => r.operation_id as string))];
  const outsByOp = new Map<string, RunOutput[]>();
  const insByOp = new Map<string, RunInput[]>();
  if (opIds.length) {
    const [outRes, inRes] = await Promise.all([
      supabase
        .from("operation_outputs")
        .select("operation_id, item_id, label, qty_per_run, role, sort_order")
        .in("operation_id", opIds)
        .in("role", ["component", "cut_part", "tooling"])
        .gt("qty_per_run", 0)
        .order("sort_order", { ascending: true }),
      supabase
        .from("operation_inputs")
        .select("operation_id, item_id, label, qty_per_run, sort_order")
        .in("operation_id", opIds)
        .gt("qty_per_run", 0)
        .order("sort_order", { ascending: true }),
    ]);
    const outRows = outRes.data ?? [];
    const inRows = inRes.data ?? [];

    const allItemIds = [
      ...new Set([...outRows, ...inRows].filter((o: any) => o.item_id).map((o: any) => o.item_id as string)),
    ];
    const itemById = new Map<string, { code: string | null; name: string }>();
    for (let i = 0; i < allItemIds.length; i += 200) {
      const { data: items } = await supabase
        .from("items")
        .select("id, code, name")
        .in("id", allItemIds.slice(i, i + 200));
      for (const it of items ?? [])
        itemById.set(it.id as string, { code: (it.code as string) ?? null, name: (it.name as string) ?? "(item)" });
    }

    const rank: Record<string, number> = { component: 0, cut_part: 1, tooling: 2 };
    for (const o of outRows) {
      const it = o.item_id ? itemById.get(o.item_id as string) : null;
      const name = it?.name ?? ((o.label as string | null) ?? "").trim();
      if (!name) continue; // nothing to display (no mapped item, no label)
      const arr = outsByOp.get(o.operation_id as string) ?? [];
      arr.push({
        code: it?.code ?? null,
        name,
        perRun: Number(o.qty_per_run) || 0,
        role: (o.role as RunOutput["role"]) ?? "component",
      });
      outsByOp.set(o.operation_id as string, arr);
    }
    // stocked components first, then loose cut-parts, then tooling
    for (const arr of outsByOp.values()) arr.sort((a, b) => (rank[a.role] ?? 0) - (rank[b.role] ?? 0));

    for (const o of inRows) {
      const it = o.item_id ? itemById.get(o.item_id as string) : null;
      const name = it?.name ?? ((o.label as string | null) ?? "").trim();
      if (!name) continue;
      const arr = insByOp.get(o.operation_id as string) ?? [];
      arr.push({ code: it?.code ?? null, name, perRun: Number(o.qty_per_run) || 0 });
      insByOp.set(o.operation_id as string, arr);
    }
  }

  return runs.map((r: any) => {
    const op = flatten<any>(r.operation);
    return {
      id: r.id as string,
      operation_id: r.operation_id as string,
      code: (op?.code as string) ?? null,
      name: (op?.name as string) ?? "(deleted program)",
      machine: (op?.machine as string) ?? "",
      machining_time_seconds: (op?.machining_time_seconds as number | null) ?? null,
      run_date: r.run_date as string,
      runs_count: Number(r.runs_count),
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
      outputs: outsByOp.get(r.operation_id as string) ?? [],
      inputs: insByOp.get(r.operation_id as string) ?? [],
    };
  });
}

export interface AuditedProgramHit {
  id: string;
  code: string | null;
  name: string;
  machine: string;
  machining_time_seconds: number | null;
}

/** Search ONLY audited, active programs — the factory may only log what has
 *  been reviewed. New/unreviewed programs must be created + audited first. */
export async function searchAuditedPrograms(
  query: string,
  limit = 20,
): Promise<AuditedProgramHit[]> {
  const q = query.trim();
  if (!q) return [];

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[%,()]/g, ""))
    .filter(Boolean);
  if (!tokens.length) return [];

  const supabase = createCacheClient();

  // Cast a BROAD net in the DB: any token on name or code. (A per-token
  // chained .or() instead ANDs into a single fat OR whose common tokens —
  // "at", "600" — flood the result, so the real program gets pushed past the
  // limit and disappears.) We then require ALL tokens and rank in memory.
  const orFilter = tokens
    .map((t) => `name.ilike.%${t}%,code.ilike.%${t}%`)
    .join(",");
  const { data, error } = await supabase
    .from("operations")
    .select("id, code, name, machine, machining_time_seconds")
    .eq("is_active", true)
    .not("audited_at", "is", null)
    .or(orFilter)
    .order("name")
    .limit(500); // candidate cap; ranking below picks the best `limit`
  if (error) throw error;

  const ql = q.toLowerCase();
  const hay = (o: any) => `${o.name ?? ""} ${o.code ?? ""}`.toLowerCase();

  const ranked = (data ?? [])
    // True AND: every token must appear somewhere in name or code.
    .filter((o: any) => tokens.every((t) => hay(o).includes(t)))
    .map((o: any) => {
      const name = ((o.name as string) ?? "").toLowerCase();
      const code = ((o.code as string) ?? "").toLowerCase();
      // Lower score = better: exact name/code, then prefix, then anywhere.
      let score = 4;
      if (name === ql || code === ql) score = 0;
      else if (name.startsWith(ql) || code.startsWith(ql)) score = 1;
      else if (name.includes(ql)) score = 2;
      return { o, score };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        ((a.o.name as string) ?? "").localeCompare(
          (b.o.name as string) ?? "",
          undefined,
          { numeric: true },
        ),
    )
    .slice(0, limit);

  return ranked.map(({ o }) => ({
    id: o.id as string,
    code: (o.code as string) ?? null,
    name: o.name as string,
    machine: o.machine as string,
    machining_time_seconds: (o.machining_time_seconds as number | null) ?? null,
  }));
}

export type RunResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordRun(input: {
  operation_id: string;
  run_date: string;
  runs_count: number;
  note?: string | null;
}): Promise<RunResult> {
  if (!input.operation_id) return { ok: false, error: "Pick a program first." };
  if (!input.run_date) return { ok: false, error: "Pick a date." };
  const count = Number(input.runs_count);
  if (!Number.isFinite(count) || count <= 0)
    return { ok: false, error: "Run count must be greater than 0." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operation_runs")
    .insert({
      operation_id: input.operation_id,
      run_date: input.run_date,
      runs_count: count,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    const msg =
      (error as any).code === "23505"
        ? "This program is already recorded for this date — adjust its count in the list instead."
        : error.message;
    return { ok: false, error: msg };
  }
  // Consume sheets + produce items for this run (best-effort: the run is logged,
  // a stock hiccup must not fail it; the reference_id guard makes a re-post safe).
  try {
    await syncRunInventory(supabase, data.id as string, count);
  } catch (e) {
    console.error("program run inventory post failed", data.id, e);
  }
  revalidatePath("/program-runs");
  return { ok: true, id: data.id as string };
}

export async function updateRunCount(
  id: string,
  runs_count: number,
): Promise<RunResult> {
  const count = Number(runs_count);
  if (!Number.isFinite(count) || count <= 0)
    return { ok: false, error: "Run count must be greater than 0." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("operation_runs")
    .update({ runs_count: count })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  // Reconcile stock to the new count — but ONLY if this run was already posted by
  // the system (forward-only: a legacy run that predates auto-posting is left alone).
  try {
    if (await runHasInventory(supabase, id)) await syncRunInventory(supabase, id, count);
  } catch (e) {
    console.error("program run inventory re-sync failed", id, e);
  }
  revalidatePath("/program-runs");
  return { ok: true, id };
}

/** Move a run entry to a different date (fixes "recorded under the wrong day"). */
export async function updateRunDate(
  id: string,
  run_date: string,
): Promise<RunResult> {
  if (!run_date) return { ok: false, error: "Pick a date." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("operation_runs")
    .update({ run_date })
    .eq("id", id);
  if (error) {
    const msg =
      (error as any).code === "23505"
        ? "That program already has an entry on the chosen date — adjust that entry's count instead."
        : error.message;
    return { ok: false, error: msg };
  }
  // A date edit is PURE metadata — it never moves stock. Auto-posting on a date
  // change is ambiguous (can't tell "correcting a genuine post-cutover run" from
  // "re-dating a pre-cutover baseline run") and could double-count against the
  // trusted physical baseline. Only record / count-edit / delete move stock, each
  // gated on run_date in syncRunInventory. To post a re-dated run, delete + re-add.
  revalidatePath("/program-runs");
  return { ok: true, id };
}

export async function deleteRun(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  // Restore the stock this run moved BEFORE deleting it (only if it was posted).
  try {
    if (await runHasInventory(supabase, id)) await syncRunInventory(supabase, id, 0);
  } catch (e) {
    console.error("program run inventory reversal failed", id, e);
  }
  const { error } = await supabase.from("operation_runs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/program-runs");
  return { ok: true };
}
