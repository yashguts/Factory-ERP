"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { JobStatus, JobStage } from "@/lib/supabase/types";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

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

export async function getJobDetail(jobId: string) {
  const supabase = await createClient();

  // Parallel: fetch job metadata + BOM header at the same time
  const [jobResult, headerResult] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).single(),
    supabase
      .from("job_bom_headers")
      .select("id")
      .eq("job_id", jobId)
      .limit(1)
      .single(),
  ]);

  if (jobResult.error) throw jobResult.error;
  const job = jobResult.data;
  const bomHeader = headerResult.data;

  let bomLines: any[] = [];
  if (bomHeader) {
    const { data, error } = await supabase
      .from("job_bom_lines")
      .select(`
        *,
        item:items(id, code, name, item_type, category_id, uom_id,
          category:item_categories(name),
          uom:units_of_measurement(abbreviation)
        )
      `)
      .eq("job_bom_id", bomHeader.id)
      .order("sort_order");

    if (error) throw error;
    bomLines = data ?? [];
  }

  return { job, bomLines, bomHeaderId: bomHeader?.id ?? null };
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
  }

  revalidateTag("jobs");
  revalidateTag("bom-lines");
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
  }

  revalidateTag("jobs");
  revalidateTag("bom-lines");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
}

export async function getJobBomSections(jobId: string) {
  const supabase = await createClient();

  const { data: header } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .single();

  if (!header) return [];

  const { data, error } = await supabase
    .from("job_bom_lines")
    .select("category, variant, value_text, required_quantity")
    .eq("job_bom_id", header.id)
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

  const [jobResult, headerResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("floors, drive_type, capacity")
      .eq("id", jobId)
      .single(),
    supabase
      .from("job_bom_headers")
      .select("id")
      .eq("job_id", jobId)
      .limit(1)
      .single(),
  ]);

  if (jobResult.error) throw jobResult.error;
  const spec = {
    floors: (jobResult.data.floors as number | null) ?? null,
    drive_type: (jobResult.data.drive_type as string | null) ?? null,
    capacity: (jobResult.data.capacity as string | null) ?? null,
  };

  if (!headerResult.data) return { spec, bomLines: [] };

  const { data, error } = await supabase
    .from("job_bom_lines")
    .select(`
      category, variant, value_text, required_quantity, item_id,
      item:items!job_bom_lines_item_id_fkey(code, name, lookup_key,
        uom:units_of_measurement(abbreviation)
      )
    `)
    .eq("job_bom_id", headerResult.data.id)
    .not("category", "is", null)
    .not("item_id", "is", null)
    .order("sort_order");
  if (error) throw error;

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

  const { data: header } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .single();

  if (!header) return [];

  const { data, error } = await supabase
    .from("job_bom_lines")
    .select(`
      category, variant, value_text, required_quantity, item_id,
      item:items!job_bom_lines_item_id_fkey(code, name,
        uom:units_of_measurement(abbreviation)
      )
    `)
    .eq("job_bom_id", header.id)
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
  }

  revalidateTag("bom-lines");
  revalidateTag("jobs");
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
  }
) {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .update(data)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
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
