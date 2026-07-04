"use server";

/**
 * R1 → BOM MIRROR — the engine that lets Packing List R1 "run the ERP".
 *
 * Architecture (owner decision 2026-07-03): the team fills the R1 list instead
 * of the old BOM form, and every R1 save mirrors its item lines into
 * `job_bom_lines` — the backbone every downstream feature reads (MRP, weekly,
 * dispatch Required·Sent·Left, job detail, cabin linkage, procurement). Nothing
 * downstream is re-pointed; the rows they read simply come from R1 now.
 *
 * Mirroring rules (all FK/dispatch-safe):
 *  - R1 item lines aggregate per item (qty summed; category = the R1 part
 *    title, which becomes the job's "section" everywhere).
 *  - Existing BOM line for the item → UPDATE in place (id preserved, so
 *    dispatch references and Sent/Left math survive). Prefers the line
 *    dispatches point at; legacy lines are ADOPTED (source set to 'r1').
 *  - Duplicate lines for the same item → extra rows deleted if undisputed,
 *    zeroed (never deleted) if a dispatch references them.
 *  - Item removed from R1 → its mirrored line is deleted if undisputed,
 *    zeroed if dispatched (history preserved, demand cleared).
 *  - LEGACY lines (source NULL) whose item is not on R1 are LEFT ALONE — they
 *    are exactly the "Unmapped Items" the owner reviews job by job.
 *  - qty <= 0 R1 lines and label-only lines don't mirror (same "non-empty"
 *    rule as the old saveBomSection).
 */
import { createClient } from "@/lib/supabase/server";
import { revalidateTag, revalidatePath } from "next/cache";

export type R1SyncResult =
  | { ok: true; updated: number; inserted: number; removed: number; zeroed: number }
  | { ok: false; error: string };

export async function syncR1ToBom(jobId: string): Promise<R1SyncResult> {
  if (!jobId) return { ok: false, error: "Missing job." };
  const supabase = await createClient();

  try {
    /* 1. Desired state: the job's R1 item lines, aggregated per item. */
    const { data: list } = await supabase
      .from("packing_r1_lists")
      .select("id")
      .eq("job_id", jobId)
      .maybeSingle();
    // No R1 list yet — nothing to mirror (job still runs on its legacy BOM).
    if (!list) return { ok: true, updated: 0, inserted: 0, removed: 0, zeroed: 0 };

    const { data: r1Lines } = await supabase
      .from("packing_r1_lines")
      .select(
        `item_id, part_title, qty, sort_order,
         template:packing_template_lines!packing_r1_lines_template_line_id_fkey(dispatch_phase)`,
      )
      .eq("list_id", list.id as string)
      .not("item_id", "is", null);

    // Items with qty 0 on R1 still participate: an existing BOM line for them is
    // zeroed/adopted (the list says "not required"), we just never INSERT them.
    // `phase` = the template line's explicit dispatch-phase override (1|2) or
    // null (inherit the part's default) — first explicit value wins per item.
    const desired = new Map<string, { qty: number; category: string; sort: number; phase: number | null }>();
    for (const l of r1Lines ?? []) {
      const qty = Math.max(0, Number(l.qty) || 0);
      const tpl = Array.isArray(l.template) ? l.template[0] : l.template;
      const explicit = (tpl?.dispatch_phase as number | null | undefined) ?? null;
      const cur = desired.get(l.item_id as string);
      if (cur) {
        cur.qty += qty;
        if (cur.phase == null && explicit != null) cur.phase = explicit;
      } else
        desired.set(l.item_id as string, {
          qty,
          category: ((l.part_title as string) || "Miscellaneous").trim() || "Miscellaneous",
          sort: Number(l.sort_order) || 0,
          phase: explicit,
        });
    }

    /* 2. Current state: the job's BOM header + lines. */
    let headerId: string;
    const { data: header } = await supabase
      .from("job_bom_headers")
      .select("id")
      .eq("job_id", jobId)
      .limit(1)
      .maybeSingle();
    if (header) headerId = header.id as string;
    else {
      const { data: created, error: hErr } = await supabase
        .from("job_bom_headers")
        .insert({ job_id: jobId, quantity: 1 })
        .select("id")
        .single();
      if (hErr) return { ok: false, error: hErr.message };
      headerId = created.id as string;
    }

    const { data: bomLines } = await supabase
      .from("job_bom_lines")
      .select("id, item_id, category, required_quantity, source, sort_order, dispatch_phase")
      .eq("job_bom_id", headerId);
    const existing = (bomLines ?? []) as {
      id: string; item_id: string | null; category: string | null;
      required_quantity: number; source: string | null; sort_order: number | null;
      dispatch_phase: number | null;
    }[];
    const hadLines = existing.length > 0;

    // Which BOM lines do dispatches point at? Those ids must never be deleted.
    const lineIds = existing.map((l) => l.id);
    const referenced = new Set<string>();
    for (let i = 0; i < lineIds.length; i += 300) {
      const { data: refs } = await supabase
        .from("job_dispatch_lines")
        .select("job_bom_line_id")
        .in("job_bom_line_id", lineIds.slice(i, i + 300));
      for (const r of refs ?? []) if (r.job_bom_line_id) referenced.add(r.job_bom_line_id as string);
    }

    const byItem = new Map<string, typeof existing>();
    for (const l of existing) {
      if (!l.item_id) continue; // label-only legacy lines: never touched
      const arr = byItem.get(l.item_id) ?? [];
      arr.push(l);
      byItem.set(l.item_id, arr);
    }

    /* 3. Reconcile. */
    const updates: { id: string; qty: number; category: string; sort: number; phase: number | null }[] = [];
    const inserts: { category: string; item_id: string; qty: number; sort: number; phase: number | null }[] = [];
    const deletes: string[] = [];
    const zeroes: string[] = [];

    for (const [itemId, want] of desired) {
      const lines = byItem.get(itemId);
      if (!lines || lines.length === 0) {
        if (want.qty > 0) inserts.push({ category: want.category, item_id: itemId, qty: want.qty, sort: want.sort, phase: want.phase });
        continue;
      }
      // Keep the dispatch-referenced line if there is one (Sent/Left stays tied
      // to the right row); otherwise the first.
      const keep = lines.find((l) => referenced.has(l.id)) ?? lines[0];
      if (
        Number(keep.required_quantity) !== want.qty ||
        (keep.category ?? "") !== want.category ||
        keep.source !== "r1" ||
        (keep.dispatch_phase ?? null) !== want.phase
      ) {
        updates.push({ id: keep.id, qty: want.qty, category: want.category, sort: want.sort, phase: want.phase });
      }
      for (const dup of lines) {
        if (dup.id === keep.id) continue;
        if (referenced.has(dup.id)) zeroes.push(dup.id); // history kept, demand cleared
        else deletes.push(dup.id);
      }
    }

    // Mirrored lines whose item was removed from R1: clear their demand.
    for (const [itemId, lines] of byItem) {
      if (desired.has(itemId)) continue;
      for (const l of lines) {
        if (l.source !== "r1") continue; // legacy stays = the Unmapped review set
        if (referenced.has(l.id)) zeroes.push(l.id);
        else deletes.push(l.id);
      }
    }

    /* 4. Apply — updates/inserts/zeroes/deletes. */
    for (const u of updates) {
      const { error } = await supabase
        .from("job_bom_lines")
        .update({ required_quantity: u.qty, category: u.category, source: "r1", sort_order: u.sort, dispatch_phase: u.phase })
        .eq("id", u.id);
      if (error) return { ok: false, error: error.message };
    }
    if (inserts.length > 0) {
      const rows = inserts.map((i) => ({
        job_bom_id: headerId,
        category: i.category,
        item_id: i.item_id,
        required_quantity: i.qty,
        sort_order: i.sort,
        source: "r1",
        dispatch_phase: i.phase,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from("job_bom_lines").insert(rows.slice(i, i + 200));
        if (error) return { ok: false, error: error.message };
      }
    }
    if (zeroes.length > 0) {
      const { error } = await supabase
        .from("job_bom_lines")
        .update({ required_quantity: 0, source: "r1" })
        .in("id", zeroes);
      if (error) return { ok: false, error: error.message };
    }
    if (deletes.length > 0) {
      for (let i = 0; i < deletes.length; i += 200) {
        const { error } = await supabase.from("job_bom_lines").delete().in("id", deletes.slice(i, i + 200));
        if (error) return { ok: false, error: error.message };
      }
    }

    /* 5. First-ever lines: stamp the GAD baseline (idempotent RPC). */
    if (!hadLines && (inserts.length > 0 || updates.length > 0)) {
      await supabase.rpc("stamp_job_bom_defined", { p_job_id: jobId });
    }

    revalidateTag("bom-lines");
    revalidateTag("jobs");
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/items`);

    return { ok: true, updated: updates.length, inserted: inserts.length, removed: deletes.length, zeroed: zeroes.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync failed." };
  }
}

/* ------------------------------------------------------------------ *
 * Small helpers for the UI chips (job detail ↔ R1 builder cross-links)
 * ------------------------------------------------------------------ */

export interface R1JobPanel {
  hasR1: boolean;
  status: "draft" | "final" | null;
  auditedAt: string | null;
  auditedBy: string | null;
  gadUrl: string | null;
  gadFilename: string | null;
}

/** Light per-job R1 header + drawing pointer, for chips/links on either side. */
export async function getR1JobPanel(jobId: string): Promise<R1JobPanel> {
  const supabase = await createClient();
  const [{ data: list }, { data: job }] = await Promise.all([
    supabase
      .from("packing_r1_lists")
      .select("status, audited_at, audited_by")
      .eq("job_id", jobId)
      .maybeSingle(),
    supabase.from("jobs").select("gad_drawing_url, gad_drawing_filename").eq("id", jobId).maybeSingle(),
  ]);
  return {
    hasR1: !!list,
    status: (list?.status as "draft" | "final" | undefined) ?? null,
    auditedAt: (list?.audited_at as string | null) ?? null,
    auditedBy: (list?.audited_by as string | null) ?? null,
    gadUrl: (job?.gad_drawing_url as string | null) ?? null,
    gadFilename: (job?.gad_drawing_filename as string | null) ?? null,
  };
}

export interface R1JobStatus {
  status: "draft" | "final";
  audited_at: string | null;
}

/** R1 list status per job — one small read (≤ a few hundred rows) powering the
 *  "R1 Final / Audited" labels on the Jobs list. Jobs with no R1 list are absent. */
export async function getR1StatusMap(): Promise<Record<string, R1JobStatus>> {
  const supabase = await createClient();
  const { data } = await supabase.from("packing_r1_lists").select("job_id, status, audited_at");
  const out: Record<string, R1JobStatus> = {};
  for (const r of data ?? []) {
    out[r.job_id as string] = {
      status: (r.status as "draft" | "final") ?? "draft",
      audited_at: (r.audited_at as string | null) ?? null,
    };
  }
  return out;
}

export interface R1DispatchView {
  /** False = job has no R1 list yet → callers keep legacy behaviour. */
  hasR1: boolean;
  /** Items on the job's R1 list (any qty). */
  itemIds: string[];
  /** All-time dispatched qty per item for this job (for Sent/Left chips). */
  dispatchedByItem: Record<string, number>;
}

/** The R1 lens on a job's dispatch state. The dispatch modal filters its rows to
 *  the R1 items (the job's item list); the R1 builder shows sent/left per line.
 *  Reads only — dispatch math itself stays in dispatch.ts, untouched. */
export async function getR1DispatchView(jobId: string): Promise<R1DispatchView> {
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("packing_r1_lists")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!list) return { hasR1: false, itemIds: [], dispatchedByItem: {} };

  const [{ data: r1Lines }, { data: dispatches }] = await Promise.all([
    supabase
      .from("packing_r1_lines")
      .select("item_id")
      .eq("list_id", list.id as string)
      .not("item_id", "is", null),
    supabase.from("job_dispatches").select("id").eq("job_id", jobId),
  ]);
  const itemIds = [...new Set((r1Lines ?? []).map((r) => r.item_id as string))];

  const dispatchedByItem: Record<string, number> = {};
  const dispatchIds = (dispatches ?? []).map((d) => d.id as string);
  if (dispatchIds.length > 0) {
    const { data: dl } = await supabase
      .from("job_dispatch_lines")
      .select("item_id, qty")
      .in("dispatch_id", dispatchIds)
      .not("item_id", "is", null);
    for (const r of dl ?? []) {
      const id = r.item_id as string;
      dispatchedByItem[id] = (dispatchedByItem[id] ?? 0) + (Number(r.qty) || 0);
    }
  }
  return { hasR1: true, itemIds, dispatchedByItem };
}

export type R1AuditResult = { ok: true } | { ok: false; error: string };

/** Mark a job's R1 list audited (or clear it). The reviewer name comes from the
 *  operator identity (no login in this app). */
export async function setR1Audited(
  jobId: string,
  audited: boolean,
  operatorName?: string,
): Promise<R1AuditResult> {
  if (!jobId) return { ok: false, error: "Missing job." };
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("packing_r1_lists")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!list) return { ok: false, error: "This job has no Packing List R1 yet." };
  const { error } = await supabase
    .from("packing_r1_lists")
    .update(
      audited
        ? { audited_at: new Date().toISOString(), audited_by: operatorName?.trim() || null }
        : { audited_at: null, audited_by: null },
    )
    .eq("id", list.id as string);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}/items`);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
