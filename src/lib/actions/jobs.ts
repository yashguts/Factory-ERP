"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { JobStatus, JobStage, JobGadVersion } from "@/lib/supabase/types";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { alertKind, reasonRequired } from "@/lib/jobs/status-alert";

export interface BomLineInput {
  category: string;
  variant?: string | null;
  value_text?: string | null;
  required_quantity?: number;
  item_id?: string | null;
}

const _getJobsUncached = async () => {
  const supabase = createCacheClient();
  return fetchAllRanged<any>((from, to, withCount) =>
    supabase
      .from("jobs")
      .select("*", withCount ? { count: "exact" } : {})
      .order("created_at", { ascending: false })
      .range(from, to),
  );
};

export const getJobs = unstable_cache(_getJobsUncached, ["jobs-list"], {
  revalidate: 600,
  tags: ["jobs"],
});

/**
 * Lightweight per-job metadata for the "Import from Existing Job" picker:
 * how many BOM lines the job has, and its door system derived from the
 * Car Header System BOM item (falling back to the Landing Header System).
 * Returned keyed by job id. Cached like getJobs; invalidated on job/BOM edits.
 */
export interface JobImportMeta {
  items: number;
  door: string | null;
}

/** ACO / AT (LHS|RHS) / AFF / MT (LHS|RHS) / Swing / Collapsible, from a header-system item name. */
function deriveDoorSystem(name: string): string {
  const n = name.toUpperCase();
  const hand = n.includes("LHS") ? " (LHS)" : n.includes("RHS") ? " (RHS)" : "";
  if (n.includes("AFF")) return "AFF";
  if (n.includes("MANUAL TELESCOPIC") || /\bMT\b/.test(n)) return `MT${hand}`;
  if (n.includes("SWING")) return `Swing${hand}`;
  if (n.includes("COLLAPSIBLE")) return `Collapsible${hand}`;
  if (/\bAT\b/.test(n)) return `AT${hand}`;
  if (n.includes("ACO") || /\bCO\b/.test(n)) return "ACO";
  return "";
}

const _getJobsImportMetaUncached = async (): Promise<
  Record<string, JobImportMeta>
> => {
  const supabase = createCacheClient();

  // Headers and lines are independent reads — fetch both (all pages, in
  // parallel bursts via fetchAllRanged) concurrently, then join in memory.
  const [headerRows, lineRows] = await Promise.all([
    fetchAllRanged<{ id: string; job_id: string }>((from, to, withCount) =>
      supabase
        .from("job_bom_headers")
        .select("id, job_id", withCount ? { count: "exact" } : {})
        .range(from, to),
    ),
    fetchAllRanged<{ job_bom_id: string }>((from, to, withCount) =>
      supabase
        .from("job_bom_lines")
        .select("job_bom_id", withCount ? { count: "exact" } : {})
        .range(from, to),
    ),
  ]);

  // header id -> job id
  const headerToJob = new Map<string, string>();
  for (const h of headerRows) headerToJob.set(h.id, h.job_id);

  // count BOM lines per job
  const counts: Record<string, number> = {};
  for (const row of lineRows) {
    const jid = headerToJob.get(row.job_bom_id);
    if (jid) counts[jid] = (counts[jid] ?? 0) + 1;
  }

  // door-system signal: prefer Car Header System, fall back to Landing
  const doorByJob: Record<string, { car?: string; landing?: string }> = {};
  {
    const { data, error } = await supabase
      .from("job_bom_lines")
      .select("job_bom_id, category, item:items(name)")
      .in("category", ["Car Header System", "Landing Header System"]);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{
      job_bom_id: string;
      category: string;
      item: { name: string } | { name: string }[] | null;
    }>) {
      const jid = headerToJob.get(row.job_bom_id);
      const itemObj = Array.isArray(row.item) ? row.item[0] : row.item;
      const name = itemObj?.name;
      if (!jid || !name) continue;
      const slot = (doorByJob[jid] ??= {});
      if (row.category === "Car Header System") slot.car ??= name;
      else slot.landing ??= name;
    }
  }

  const out: Record<string, JobImportMeta> = {};
  for (const jid of new Set([
    ...Object.keys(counts),
    ...Object.keys(doorByJob),
  ])) {
    const src = doorByJob[jid]?.car ?? doorByJob[jid]?.landing ?? null;
    out[jid] = {
      items: counts[jid] ?? 0,
      door: src ? deriveDoorSystem(src) || null : null,
    };
  }
  return out;
};

export const getJobsImportMeta = unstable_cache(
  _getJobsImportMetaUncached,
  ["jobs-import-meta"],
  { revalidate: 600, tags: ["jobs", "bom-lines"] },
);

/**
 * Readiness flags for the Dispatch Plan board, so each job row can show — at a
 * glance — whether it has a Job BOM and a Cabin BOM. (Drawing readiness comes
 * straight off `jobs.gad_drawing_url`, so it isn't computed here.)
 *
 * Returned as plain arrays because this crosses the server→client boundary
 * (Sets don't serialise). `cabinJobNumbers` are normalised lower(btrim(...)) to
 * match how `cabin_jobs` is keyed (there is no FK from jobs to cabin_jobs — the
 * link is the job number text).
 */
export interface JobReadinessFlags {
  /** Job ids that have at least one job_bom_lines row. */
  bomJobIds: string[];
  /** Normalised cabin job_numbers that have at least one cabin_job_line. */
  cabinJobNumbers: string[];
  /** Normalised cabin job_numbers whose cabin job is MARKED READY — regardless
   *  of line count (a ready cabin job may have zero lines). Shown blue. */
  cabinReadyJobNumbers: string[];
}

const _getJobReadinessFlagsUncached =
  async (): Promise<JobReadinessFlags> => {
    const supabase = createCacheClient();

    // Ask Postgres for a per-parent line COUNT rather than pulling every line
    // row. The parent tables are small (one header per job-BOM section, one
    // row per cabin job), so each of these is a single un-paginated request —
    // which also sidesteps the all-rows fetch silently truncating to its first
    // page when the exact-count is unavailable.
    const [headerRes, cabinRes] = await Promise.all([
      supabase
        .from("job_bom_headers")
        .select("job_id, job_bom_lines(count)"),
      supabase
        .from("cabin_jobs")
        .select("job_number, marked_ready_at, cabin_job_lines(count)"),
    ]);
    if (headerRes.error) throw headerRes.error;
    if (cabinRes.error) throw cabinRes.error;

    // Job BOM: a job is "filled" when any of its headers has ≥1 line.
    const bomJobIds = new Set<string>();
    for (const h of (headerRes.data ?? []) as Array<{
      job_id: string | null;
      job_bom_lines: { count: number }[] | null;
    }>) {
      const n = h.job_bom_lines?.[0]?.count ?? 0;
      if (n > 0 && h.job_id) bomJobIds.add(h.job_id);
    }

    // Cabin BOM: cabin jobs with ≥1 line → their normalised job numbers
    // (lower(btrim(...)) to match how jobs link to cabin_jobs by number text).
    // Marked-ready is tracked separately and ignores line count — the factory
    // can flag a cabin done even when its BOM was never itemised.
    const cabinJobNumbers = new Set<string>();
    const cabinReadyJobNumbers = new Set<string>();
    for (const c of (cabinRes.data ?? []) as Array<{
      job_number: string | null;
      marked_ready_at: string | null;
      cabin_job_lines: { count: number }[] | null;
    }>) {
      const n = c.cabin_job_lines?.[0]?.count ?? 0;
      const num = (c.job_number ?? "").trim().toLowerCase();
      if (!num) continue;
      if (n > 0) cabinJobNumbers.add(num);
      if (c.marked_ready_at) cabinReadyJobNumbers.add(num);
    }

    return {
      bomJobIds: [...bomJobIds],
      cabinJobNumbers: [...cabinJobNumbers],
      cabinReadyJobNumbers: [...cabinReadyJobNumbers],
    };
  };

export const getJobReadinessFlags = unstable_cache(
  _getJobReadinessFlagsUncached,
  ["job-readiness-flags"],
  { revalidate: 600, tags: ["jobs", "bom-lines", "cabin-jobs"] },
);

export async function getJobDetail(jobId: string) {
  // Cached per-job — every write path touching these tables revalidates one
  // of the tags (job/BOM saves, dispatches, GAD uploads, item/category edits,
  // stock moves), so repeat views between mutations skip the cross-region reads.
  return unstable_cache(_getJobDetailUncached, ["job-detail", jobId], {
    revalidate: 300,
    tags: ["jobs", "bom-lines", "items", "categories", "inventory-stock", "gad-alerts"],
  })(jobId);
}

async function _getJobDetailUncached(jobId: string) {
  const supabase = createCacheClient();

  // One parallel round-trip: job metadata + BOM header id + BOM lines + GAD
  // version history. The lines filter to this job through an empty header
  // embed (pure filter — adds no key to the rows) so they don't wait on the
  // header id; the separate header query stays because bomHeaderId is
  // returned even when a header has zero lines. The nested inventory rows
  // fold per-item stock in, replacing the dependent getStockForItems
  // round-trip on the detail page.
  const [jobResult, headerResult, linesResult, versionsResult] =
    await Promise.all([
      supabase.from("jobs").select("*").eq("id", jobId).single(),
      supabase
        .from("job_bom_headers")
        .select("id")
        .eq("job_id", jobId)
        .limit(1)
        .single(),
      supabase
        .from("job_bom_lines")
        .select(`
          *,
          item:items(id, code, name, item_type, category_id, uom_id,
            category:item_categories(name),
            uom:units_of_measurement!items_uom_id_fkey(abbreviation),
            inventory(quantity)
          ),
          hdr:job_bom_headers!inner()
        `)
        .eq("hdr.job_id", jobId)
        .order("sort_order"),
      supabase
        .from("job_gad_versions")
        .select("*")
        .eq("job_id", jobId)
        .order("revision_no", { ascending: false }),
    ]);

  if (jobResult.error) throw jobResult.error;
  const job = jobResult.data;
  const bomHeader = headerResult.data;
  const gadVersions = (versionsResult.data ?? []) as JobGadVersion[];

  if (linesResult.error) throw linesResult.error;
  const bomLines: any[] = linesResult.data ?? [];

  // Sum on-hand stock per item across warehouses, then strip the nested rows
  // so each line keeps exactly the shape the clients already expect.
  const stockByItem: Record<string, number> = {};
  for (const line of bomLines) {
    const item = Array.isArray(line.item) ? line.item[0] : line.item;
    if (!item) continue;
    const inv = (item.inventory ?? []) as Array<{ quantity: number }>;
    if (item.id && inv.length > 0) {
      stockByItem[item.id] = inv.reduce(
        (sum, r) => sum + (Number(r.quantity) || 0),
        0,
      );
    }
    delete item.inventory;
  }

  return {
    job,
    bomLines,
    bomHeaderId: bomHeader?.id ?? null,
    gadVersions,
    stockByItem,
  };
}

/**
 * "Mark Audited (with changes)" for a job's BOM — the jobs analogue of
 * setOperationAudited (operations.ts). Acknowledges the CURRENT GAD revision so
 * the drift alert (src/lib/jobs/gad-alert.ts) clears across every surface. If
 * the GAD is changed again later, the alert re-raises automatically.
 */
export async function setJobBomAudited(
  jobId: string,
  audited: boolean,
  operator?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!jobId) return { ok: false, error: "Missing jobId" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_bom_audited", {
    p_job_id: jobId,
    p_audited: audited,
    p_by: operator ?? "unknown",
  });
  if (error) return { ok: false, error: error.message };
  revalidateTag("jobs");
  revalidateTag("gad-alerts");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

export async function createJob(data: {
  job_number: string;
  customer_name?: string | null;
  /** Optional contact mobile number — NULL or exactly 10 digits. */
  mobile_number?: string | null;
  description?: string | null;
  status?: JobStatus;
  spec_string?: string | null;
  door_finish?: string | null;
  location?: string | null;
  progress?: number | null;
  order_date?: string | null;
  expected_delivery?: string | null;
  brand?: string | null;
  floors?: number | null;
  door_type?: string | null;
  drive_type?: string | null;
  capacity?: string | null;
  remark?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  stage?: JobStage;
  requirement_stage?: JobStage | null;
  requirement_dispatch_date?: string | null;
  structure_included?: "NA" | "Factory-made" | "Site-fabricated";
  /** Operator who created the job (identity, not auth). */
  created_by?: string | null;
}) {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  revalidateTag("jobs");
  return job;
}

export async function createJobWithBom(
  jobData: {
    job_number: string;
    customer_name?: string | null;
    description?: string | null;
    status?: JobStatus;
    spec_string?: string | null;
    door_finish?: string | null;
    location?: string | null;
    brand?: string | null;
    floors?: number | null;
    door_type?: string | null;
    drive_type?: string | null;
    capacity?: string | null;
    remark?: string | null;
    order_date?: string | null;
    expected_delivery?: string | null;
    stage?: JobStage;
    requirement_stage?: JobStage | null;
    requirement_dispatch_date?: string | null;
    structure_included?: "NA" | "Factory-made" | "Site-fabricated";
  },
  bomLines: BomLineInput[],
) {
  const supabase = await createClient();

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert(jobData)
    .select()
    .single();
  if (jobErr) throw jobErr;

  const { data: header, error: hdrErr } = await supabase
    .from("job_bom_headers")
    .insert({ job_id: job.id, quantity: 1 })
    .select("id")
    .single();
  if (hdrErr) throw hdrErr;

  const nonEmpty = bomLines.filter(
    (l) =>
      (l.required_quantity != null && l.required_quantity !== 0) ||
      (l.value_text != null && l.value_text !== ""),
  );

  if (nonEmpty.length > 0) {
    const rows = nonEmpty.map((l, i) => ({
      job_bom_id: header.id,
      category: l.category,
      variant: l.variant,
      value_text: l.value_text ?? null,
      required_quantity: l.required_quantity ?? 0,
      item_id: l.item_id ?? null,
      sort_order: i,
    }));

    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error: lineErr } = await supabase
        .from("job_bom_lines")
        .insert(rows.slice(i, i + BATCH));
      if (lineErr) throw lineErr;
    }

    // BOM is now defined — stamp the one-time baseline (the GAD revision the BOM
    // was built against). Idempotent: only fires while bom_defined_at IS NULL.
    await supabase.rpc("stamp_job_bom_defined", { p_job_id: job.id });
  }

  revalidateTag("jobs");
  revalidateTag("bom-lines");
  revalidateTag("gad-alerts");
  return job;
}

export async function updateJobWithBom(
  jobId: string,
  jobData: {
    customer_name?: string | null;
    description?: string | null;
    status?: JobStatus;
    spec_string?: string | null;
    door_finish?: string | null;
    location?: string | null;
    brand?: string | null;
    floors?: number | null;
    door_type?: string | null;
    drive_type?: string | null;
    capacity?: string | null;
    remark?: string | null;
    order_date?: string | null;
    expected_delivery?: string | null;
    stage?: JobStage;
    requirement_stage?: JobStage | null;
    requirement_dispatch_date?: string | null;
    structure_included?: "NA" | "Factory-made" | "Site-fabricated";
  },
  bomLines: BomLineInput[],
) {
  const supabase = await createClient();

  const { error: jobErr } = await supabase
    .from("jobs")
    .update(jobData)
    .eq("id", jobId);
  if (jobErr) throw jobErr;

  let headerId: string;
  const { data: existing } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .single();

  if (existing) {
    headerId = existing.id;
    // Delete ALL existing lines — picker is the source of truth
    await supabase
      .from("job_bom_lines")
      .delete()
      .eq("job_bom_id", headerId);
  } else {
    const { data: header, error: hdrErr } = await supabase
      .from("job_bom_headers")
      .insert({ job_id: jobId, quantity: 1 })
      .select("id")
      .single();
    if (hdrErr) throw hdrErr;
    headerId = header.id;
  }

  const nonEmpty = bomLines.filter(
    (l) =>
      (l.required_quantity != null && l.required_quantity !== 0) ||
      (l.value_text != null && l.value_text !== ""),
  );

  if (nonEmpty.length > 0) {
    const rows = nonEmpty.map((l, i) => ({
      job_bom_id: headerId,
      category: l.category,
      variant: l.variant,
      value_text: l.value_text ?? null,
      required_quantity: l.required_quantity ?? 0,
      item_id: l.item_id ?? null,
      sort_order: i,
    }));

    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error: lineErr } = await supabase
        .from("job_bom_lines")
        .insert(rows.slice(i, i + BATCH));
      if (lineErr) throw lineErr;
    }

    // First-time BOM-defined baseline (no-op if already stamped).
    await supabase.rpc("stamp_job_bom_defined", { p_job_id: jobId });
  }

  revalidateTag("jobs");
  revalidateTag("bom-lines");
  revalidateTag("gad-alerts");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
}

export async function getJobBomSections(jobId: string) {
  const supabase = await createClient();

  // Single round-trip: filter to this job's lines through an empty header
  // embed (pure filter, adds no key) instead of resolving the header id first.
  const { data, error } = await supabase
    .from("job_bom_lines")
    .select(
      "category, variant, value_text, required_quantity, hdr:job_bom_headers!inner()",
    )
    .eq("hdr.job_id", jobId)
    .not("category", "is", null)
    .order("sort_order");

  if (error) throw error;
  return data ?? [];
}

/** Fetch item-based BOM lines for edit-page reference display */
/**
 * Returns a job's "templatable" content: its elevator spec (floors,
 * drive type, capacity) plus every item-based BOM line. Used by the
 * "Import from existing job" flow on the new-job page so the user can
 * clone the spec + BOM and only override what differs.
 *
 * Deliberately does NOT return Job Details (number, customer, dates,
 * stage, etc.) — those are always re-entered for the new job.
 */
export async function getJobTemplate(jobId: string) {
  const supabase = createCacheClient();

  // One parallel round-trip: the lines filter to this job through an empty
  // header embed (pure filter, adds no key) instead of waiting on the header id.
  const [jobResult, linesResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("floors, drive_type, capacity")
      .eq("id", jobId)
      .single(),
    supabase
      .from("job_bom_lines")
      .select(`
        category, variant, value_text, required_quantity, item_id,
        item:items!job_bom_lines_item_id_fkey(code, name, lookup_key,
          uom:units_of_measurement!items_uom_id_fkey(abbreviation)
        ),
        hdr:job_bom_headers!inner()
      `)
      .eq("hdr.job_id", jobId)
      .not("category", "is", null)
      .not("item_id", "is", null)
      .order("sort_order"),
  ]);

  if (jobResult.error) throw jobResult.error;
  const spec = {
    floors: (jobResult.data.floors as number | null) ?? null,
    drive_type: (jobResult.data.drive_type as string | null) ?? null,
    capacity: (jobResult.data.capacity as string | null) ?? null,
  };

  if (linesResult.error) throw linesResult.error;
  const data = linesResult.data;

  const flatten = <T,>(rel: unknown): T | null => {
    if (!rel) return null;
    if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
    return rel as T;
  };

  const bomLines = (data ?? []).map((row: any) => {
    const itemRow = flatten<{
      code: string;
      name: string;
      lookup_key: string | null;
      uom: unknown;
    }>(row.item);
    const uomRow = itemRow
      ? flatten<{ abbreviation: string }>(itemRow.uom)
      : null;
    return {
      category: row.category as string,
      variant: row.variant as string | null,
      value_text: row.value_text as string | null,
      required_quantity: row.required_quantity as number,
      item_id: row.item_id as string | null,
      item: itemRow
        ? {
            code: itemRow.code,
            name: itemRow.name,
            lookup_key: itemRow.lookup_key ?? null,
            uom: uomRow ? { abbreviation: uomRow.abbreviation } : null,
          }
        : null,
    };
  });

  return { spec, bomLines };
}

export async function getJobBomItemLines(jobId: string) {
  const supabase = await createClient();

  // Single round-trip: filter to this job's lines through an empty header
  // embed (pure filter, adds no key) instead of resolving the header id first.
  const { data, error } = await supabase
    .from("job_bom_lines")
    .select(`
      category, variant, value_text, required_quantity, item_id,
      item:items!job_bom_lines_item_id_fkey(code, name,
        uom:units_of_measurement!items_uom_id_fkey(abbreviation)
      ),
      hdr:job_bom_headers!inner()
    `)
    .eq("hdr.job_id", jobId)
    .not("category", "is", null)
    .order("sort_order");

  if (error) throw error;

  // PostgREST may return a belongsTo relation as either an object or a
  // single-element array depending on the planner. Normalize both shapes.
  const flatten = <T,>(rel: unknown): T | null => {
    if (!rel) return null;
    if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
    return rel as T;
  };

  return (data ?? []).map((row: any) => {
    const itemRow = flatten<{ code: string; name: string; uom: any }>(row.item);
    const uomRow = itemRow ? flatten<{ abbreviation: string }>(itemRow.uom) : null;
    return {
      category: row.category as string,
      variant: row.variant as string | null,
      value_text: row.value_text as string | null,
      required_quantity: row.required_quantity as number,
      item_id: row.item_id as string | null,
      item: itemRow
        ? {
            code: itemRow.code,
            name: itemRow.name,
            uom: uomRow ? { abbreviation: uomRow.abbreviation } : null,
          }
        : null,
    };
  });
}

/**
 * Save BOM lines for the given categories only (per-section save).
 *
 * IMPORTANT: this DELETES every existing job_bom_lines row whose
 * `category` is in `categories`, then inserts the provided lines.
 * The picker is treated as the source of truth for those sections —
 * if `bomLines` is empty, those sections are wiped. If you need to
 * preserve unmapped/legacy rows, exclude their categories from the
 * `categories` argument or use a different code path.
 */
export async function saveBomSection(
  jobId: string,
  categories: string[],
  bomLines: BomLineInput[],
) {
  const supabase = await createClient();

  // Ensure BOM header exists
  let headerId: string;
  const { data: existing } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .single();

  if (existing) {
    headerId = existing.id;
  } else {
    const { data: header, error: hdrErr } = await supabase
      .from("job_bom_headers")
      .insert({ job_id: jobId, quantity: 1 })
      .select("id")
      .single();
    if (hdrErr) throw hdrErr;
    headerId = header.id;
  }

  // Delete ALL existing lines for these categories in one call
  await supabase
    .from("job_bom_lines")
    .delete()
    .eq("job_bom_id", headerId)
    .in("category", categories);

  // Insert new lines
  const nonEmpty = bomLines.filter(
    (l) =>
      categories.includes(l.category) &&
      ((l.required_quantity != null && l.required_quantity !== 0) ||
        (l.value_text != null && l.value_text !== "") ||
        l.item_id != null),
  );

  if (nonEmpty.length > 0) {
    const rows = nonEmpty.map((l, i) => ({
      job_bom_id: headerId,
      category: l.category,
      variant: l.variant,
      value_text: l.value_text ?? null,
      required_quantity: l.required_quantity ?? 0,
      item_id: l.item_id ?? null,
      sort_order: i,
    }));

    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error: lineErr } = await supabase
        .from("job_bom_lines")
        .insert(rows.slice(i, i + BATCH));
      if (lineErr) throw lineErr;
    }

    // First non-empty section save defines the BOM — stamp the GAD baseline once.
    await supabase.rpc("stamp_job_bom_defined", { p_job_id: jobId });
  }

  revalidateTag("bom-lines");
  revalidateTag("jobs");
  revalidateTag("gad-alerts");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
}

export async function updateJob(
  id: string,
  data: {
    job_number?: string;
    customer_name?: string | null;
    /** Optional contact mobile number — NULL or exactly 10 digits. */
    mobile_number?: string | null;
    description?: string | null;
    status?: JobStatus;
    spec_string?: string | null;
    door_finish?: string | null;
    location?: string | null;
    progress?: number | null;
    order_date?: string | null;
    expected_delivery?: string | null;
    brand?: string | null;
    floors?: number | null;
    door_type?: string | null;
    drive_type?: string | null;
    capacity?: string | null;
    remark?: string | null;
    planned_start?: string | null;
    planned_end?: string | null;
    actual_start?: string | null;
    actual_end?: string | null;
    notes?: string | null;
    stage?: JobStage;
    requirement_stage?: JobStage | null;
    requirement_dispatch_date?: string | null;
    structure_included?: "NA" | "Factory-made" | "Site-fabricated";
  },
  operator?: string | null,
  /** Mandatory when the update CHANGES status or requirement_dispatch_date —
   *  per management, neither may move without a written reason. */
  changeReason?: string | null,
) {
  const supabase = await createClient();
  const cleanReason = changeReason?.trim() || null;

  // The status dropdowns use changeJobStatus(); the edit form comes through
  // here — snapshot the prior status/date so a change is still gated on a
  // reason and logged, never unrecorded.
  let prevStatus: JobStatus | undefined;
  let prevDispatchDate: string | null | undefined;
  if (data.status !== undefined || data.requirement_dispatch_date !== undefined) {
    const { data: cur } = await supabase
      .from("jobs")
      .select("status, requirement_dispatch_date")
      .eq("id", id)
      .maybeSingle();
    prevStatus = (cur?.status as JobStatus) ?? undefined;
    prevDispatchDate = (cur?.requirement_dispatch_date as string | null) ?? null;
  }

  const statusChanged =
    data.status !== undefined && prevStatus !== undefined && prevStatus !== data.status;
  const dateChanged =
    data.requirement_dispatch_date !== undefined &&
    prevDispatchDate !== undefined &&
    (prevDispatchDate ?? null) !== (data.requirement_dispatch_date ?? null);

  // Hard gate: no status / dispatch-date change without a reason. The UI asks
  // before calling; this is the backstop so no path can slip a silent change.
  if (statusChanged && !cleanReason && reasonRequired(prevStatus ?? null, data.status!)) {
    throw new Error("A reason is required to change a job's status.");
  }
  if (dateChanged && !cleanReason) {
    throw new Error("A reason is required to change the Req. Dispatch Date.");
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .update(data)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  if (statusChanged) {
    await supabase.from("job_status_changes").insert({
      job_id: id, from_status: prevStatus, to_status: data.status,
      alert_kind: alertKind(prevStatus ?? null, data.status!), reason: cleanReason, changed_by: operator ?? null,
    });
    revalidateTag("status-alerts");
    revalidatePath("/jobs/status-alerts");
  }
  if (dateChanged) {
    await supabase.from("job_date_changes").insert({
      job_id: id,
      from_date: prevDispatchDate ?? null,
      to_date: data.requirement_dispatch_date ?? null,
      reason: cleanReason,
      changed_by: operator ?? null,
    });
  }

  revalidateTag("jobs");
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/edit`);
  return job;
}

/**
 * Permanently delete a job and everything attached to it:
 *   - job_bom_headers + job_bom_lines (DB cascades these)
 *   - the GAD drawing in Supabase Storage, if any
 *
 * No soft-delete; the row goes away. Returns a small result the
 * client can act on (e.g. show an error or redirect).
 */
export async function deleteJob(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!jobId) return { ok: false, error: "Missing jobId" };

  const supabase = await createClient();

  // 1. Best-effort: pull the drawing URL so we can clean storage too.
  const { data: row } = await supabase
    .from("jobs")
    .select("gad_drawing_url")
    .eq("id", jobId)
    .single();
  const url = (row?.gad_drawing_url as string | null) ?? null;
  if (url) {
    const marker = "/object/public/gad-drawings/";
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      const path = decodeURIComponent(url.slice(idx + marker.length));
      await supabase.storage.from("gad-drawings").remove([path]);
    }
  }

  // 2. Delete the job row. CASCADE handles job_bom_headers and
  //    job_bom_lines via the existing FKs.
  const { error } = await supabase.from("jobs").delete().eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  revalidateTag("jobs");
  revalidateTag("bom-lines");
  revalidatePath("/jobs");
  return { ok: true };
}
