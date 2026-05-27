"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { JobStatus, JobStage } from "@/lib/supabase/types";

export interface BomLineInput {
  category: string;
  variant?: string | null;
  value_text?: string | null;
  required_quantity?: number;
  item_id?: string | null;
}

const _getJobsUncached = async () => {
  const supabase = createCacheClient();

  const PAGE = 1000;
  let allJobs: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    allJobs = allJobs.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }

  return allJobs;
};

export const getJobs = unstable_cache(_getJobsUncached, ["jobs-list"], {
  revalidate: 60,
  tags: ["jobs"],
});

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
  const flatten = <T,>(rel: any): T | null => {
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
