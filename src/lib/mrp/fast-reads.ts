// MRP's two big raw reads, each as ONE database query (migration 078) with the
// original paged read kept as an automatic fallback.
//
// These return exactly the rows/sums the paged reads returned (verified on live
// data 2026-11-19: 29,036 BOM lines and 16,881 dispatched sums identical). No
// MRP rule lives here — stage scope, dispatch netting and the demand folds all
// stay in mrp.ts / mrp-weekly.ts, untouched.
//
// Why: the web server (Singapore) is a hop from the database (Mumbai). A cold
// MRP load used to fire ~30 requests for BOM lines (each with ~330 header ids
// in the URL) plus ~18 for dispatch lines.
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { createCacheClient } from "@/lib/supabase/cache-client";

type Supabase = ReturnType<typeof createCacheClient>;

export interface MrpBomLine {
  id: string;
  item_id: string;
  required_quantity: number;
  job_bom_id: string;
  category: string | null;
  dispatch_phase: number | null;
}

/** Job BOM lines (item mapped, required > 0) for the given BOM headers. */
export async function fetchMrpBomLines(
  supabase: Supabase,
  headerIds: string[],
): Promise<MrpBomLine[]> {
  if (headerIds.length === 0) return [];
  const fast = await supabase.rpc("erp_mrp_bom_lines", { p_header_ids: headerIds });
  if (!fast.error && Array.isArray(fast.data)) {
    // Compact rows: [id, item_id, required_quantity, job_bom_id, category, dispatch_phase]
    return (fast.data as unknown[][]).map((r) => ({
      id: r[0] as string,
      item_id: r[1] as string,
      required_quantity: r[2] as number,
      job_bom_id: r[3] as string,
      category: (r[4] as string | null) ?? null,
      dispatch_phase: (r[5] as number | null) ?? null,
    }));
  }
  if (fast.error) console.error("erp_mrp_bom_lines failed — using paged read", fast.error);
  return fetchAllRanged<MrpBomLine>((from, to, withCount) =>
    supabase
      .from("job_bom_lines")
      .select(
        "id, item_id, required_quantity, job_bom_id, category, dispatch_phase",
        withCount ? { count: "exact" } : {},
      )
      .in("job_bom_id", headerIds)
      .not("item_id", "is", null)
      .gt("required_quantity", 0)
      .range(from, to),
  );
}

/** Dispatched-so-far qty per job BOM line, across the whole table. */
export async function fetchDispatchedByBomLine(
  supabase: Supabase,
): Promise<Map<string, number>> {
  const dispatchedByLine = new Map<string, number>();
  const fast = await supabase.rpc("erp_dispatched_qty_by_bom_line");
  if (!fast.error && fast.data && typeof fast.data === "object" && !Array.isArray(fast.data)) {
    for (const [lineId, qty] of Object.entries(fast.data as Record<string, number>)) {
      dispatchedByLine.set(lineId, Number(qty) || 0);
    }
    return dispatchedByLine;
  }
  if (fast.error) console.error("erp_dispatched_qty_by_bom_line failed — using paged read", fast.error);
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
}
