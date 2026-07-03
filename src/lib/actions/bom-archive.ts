"use server";

/**
 * BOM ARCHIVE — read-only view of the pre-cutover Job Order BOMs.
 *
 * On 2026-07-03 Packing List R1 became each job's item source of truth and the
 * live BOM lines were rewritten from R1 (see r1-bom-sync.ts). Right before that
 * rewrite, every BOM line of the 154 affected jobs was snapshotted into
 * `r1_cutover_bom_backup` (7,184 rows, full line JSON). This section lets the
 * factory team keep referring to the data they had entered on the old BOM for a
 * transition period. Frozen data — never written, safe to remove later.
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

export interface BomArchiveJob {
  job_id: string;
  job_number: string | null;
  customer_name: string | null;
  lines: number;
  captured_at: string;
}

export interface BomArchiveLine {
  code: string | null;
  name: string | null;
  uom: string | null;
  qty: number;
  variant: string | null;
  value_text: string | null;
}
export interface BomArchiveSection {
  category: string;
  lines: BomArchiveLine[];
}
export interface BomArchiveView {
  job_id: string;
  job_number: string | null;
  customer_name: string | null;
  captured_at: string | null;
  sections: BomArchiveSection[];
  totalLines: number;
}

const _getBomArchiveJobsUncached = async (): Promise<BomArchiveJob[]> => {
  const supabase = createCacheClient();
  // 7k tiny rows (3 cols), paged past the PostgREST cap, aggregated here.
  const rows = await fetchAllRanged<{ job_id: string; job_number: string | null; batch_at: string }>(
    (from, to, withCount) =>
      supabase
        .from("r1_cutover_bom_backup")
        .select("job_id, job_number, batch_at", withCount ? { count: "exact" } : {})
        .order("id")
        .range(from, to),
  );
  const byJob = new Map<string, BomArchiveJob>();
  for (const r of rows) {
    if (!r.job_id) continue;
    const ex = byJob.get(r.job_id);
    if (ex) ex.lines += 1;
    else byJob.set(r.job_id, { job_id: r.job_id, job_number: r.job_number ?? null, customer_name: null, lines: 1, captured_at: r.batch_at });
  }
  // Customer names from jobs (chunked).
  const ids = [...byJob.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("jobs").select("id, customer_name").in("id", ids.slice(i, i + 200));
    for (const j of data ?? []) {
      const ex = byJob.get(j.id as string);
      if (ex) ex.customer_name = (j.customer_name as string | null) ?? null;
    }
  }
  return [...byJob.values()].sort((a, b) => (a.job_number ?? "").localeCompare(b.job_number ?? "", undefined, { numeric: true }));
};

/** All jobs with an archived (pre-cutover) BOM snapshot. Frozen data → cached hard. */
export async function getBomArchiveJobs(): Promise<BomArchiveJob[]> {
  return unstable_cache(_getBomArchiveJobsUncached, ["bom-archive-jobs"], { revalidate: 3600 })();
}

const _getBomArchiveUncached = async (jobId: string): Promise<BomArchiveView | null> => {
  const supabase = createCacheClient();
  const rows = await fetchAllRanged<{ job_number: string | null; batch_at: string; line_snapshot: Record<string, unknown> }>(
    (from, to, withCount) =>
      supabase
        .from("r1_cutover_bom_backup")
        .select("job_number, batch_at, line_snapshot", withCount ? { count: "exact" } : {})
        .eq("job_id", jobId)
        .order("id")
        .range(from, to),
  );
  if (rows.length === 0) return null;

  interface Parsed {
    category: string;
    item_id: string | null;
    qty: number;
    variant: string | null;
    value_text: string | null;
    sort: number;
  }
  const parsed: Parsed[] = rows.map((r) => {
    const s = r.line_snapshot ?? {};
    return {
      category: ((s.category as string) || "Uncategorised").trim() || "Uncategorised",
      item_id: (s.item_id as string | null) ?? null,
      qty: Number(s.required_quantity ?? 0) || 0,
      variant: (s.variant as string | null) ?? null,
      value_text: (s.value_text as string | null) ?? null,
      sort: Number(s.sort_order ?? 0) || 0,
    };
  });

  // Item identity for display.
  const itemIds = [...new Set(parsed.map((p) => p.item_id).filter(Boolean))] as string[];
  const info = new Map<string, { code: string; name: string; uom: string | null }>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation)")
      .in("id", itemIds.slice(i, i + 200));
    for (const it of (data ?? []) as any[]) {
      const uom = Array.isArray(it.uom) ? it.uom[0] : it.uom;
      info.set(it.id as string, { code: (it.code as string) ?? "", name: (it.name as string) ?? "", uom: uom?.abbreviation ?? null });
    }
  }

  const byCat = new Map<string, { line: BomArchiveLine; sort: number }[]>();
  for (const p of parsed) {
    const it = p.item_id ? info.get(p.item_id) : null;
    const arr = byCat.get(p.category) ?? [];
    arr.push({
      line: { code: it?.code ?? null, name: it?.name ?? null, uom: it?.uom ?? null, qty: p.qty, variant: p.variant, value_text: p.value_text },
      sort: p.sort,
    });
    byCat.set(p.category, arr);
  }
  const sections: BomArchiveSection[] = [...byCat.entries()]
    .map(([category, arr]) => ({
      category,
      lines: arr.sort((a, b) => a.sort - b.sort).map((x) => x.line),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const { data: job } = await supabase.from("jobs").select("customer_name").eq("id", jobId).maybeSingle();

  return {
    job_id: jobId,
    job_number: rows[0].job_number ?? null,
    customer_name: (job?.customer_name as string | null) ?? null,
    captured_at: rows[0].batch_at ?? null,
    sections,
    totalLines: parsed.length,
  };
};

/** One job's archived BOM, grouped by its old section names. */
export async function getBomArchive(jobId: string): Promise<BomArchiveView | null> {
  return unstable_cache(() => _getBomArchiveUncached(jobId), ["bom-archive", jobId], { revalidate: 3600 })();
}
