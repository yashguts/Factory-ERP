"use server";

import { createClient } from "@/lib/supabase/server";
import type { JobStatus, JobStage } from "@/lib/supabase/types";

export interface BomLineInput {
  category: string;
  variant: string;
  value_text?: string | null;
  required_quantity?: number;
  item_id?: string | null;
}

export async function getJobs() {
  const supabase = await createClient();

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
}

export async function getJobDetail(jobId: string) {
  const supabase = await createClient();

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr) throw jobErr;

  const { data: bomHeader } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .single();

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
  customer_name?: string;
  description?: string;
  status?: JobStatus;
  spec_string?: string;
  door_finish?: string;
  location?: string;
  progress?: number;
  order_date?: string;
  expected_delivery?: string;
  brand?: string;
  floors?: number;
  door_type?: string;
  drive_type?: string;
  capacity?: string;
  remark?: string;
  planned_start?: string;
  planned_end?: string;
  stage?: JobStage;
  requirement_stage?: JobStage;
  requirement_dispatch_date?: string;
}) {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return job;
}

export async function createJobWithBom(
  jobData: {
    job_number: string;
    customer_name?: string;
    description?: string;
    status?: JobStatus;
    spec_string?: string;
    door_finish?: string;
    location?: string;
    brand?: string;
    floors?: number;
    door_type?: string;
    drive_type?: string;
    capacity?: string;
    remark?: string;
    order_date?: string;
    expected_delivery?: string;
    stage?: JobStage;
    requirement_stage?: JobStage;
    requirement_dispatch_date?: string;
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

  return job;
}

export async function updateJobWithBom(
  jobId: string,
  jobData: {
    customer_name?: string;
    description?: string;
    status?: JobStatus;
    spec_string?: string;
    door_finish?: string;
    location?: string;
    brand?: string;
    floors?: number;
    door_type?: string;
    drive_type?: string;
    capacity?: string;
    remark?: string;
    order_date?: string;
    expected_delivery?: string;
    stage?: JobStage;
    requirement_stage?: JobStage;
    requirement_dispatch_date?: string;
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
    // Delete old form-created lines — keep Excel-imported lines (which have source_col_index set)
    await supabase
      .from("job_bom_lines")
      .delete()
      .eq("job_bom_id", headerId)
      .is("source_col_index", null);
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

/** Save BOM lines for specific categories only (per-section save). */
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

  // Delete old form-created lines for these categories only
  for (const cat of categories) {
    await supabase
      .from("job_bom_lines")
      .delete()
      .eq("job_bom_id", headerId)
      .eq("category", cat)
      .is("source_col_index", null);
  }

  // Insert new lines
  const nonEmpty = bomLines.filter(
    (l) =>
      categories.includes(l.category) &&
      ((l.required_quantity != null && l.required_quantity !== 0) ||
        (l.value_text != null && l.value_text !== "")),
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
}

export async function updateJob(
  id: string,
  data: {
    job_number?: string;
    customer_name?: string;
    description?: string;
    status?: JobStatus;
    spec_string?: string;
    door_finish?: string;
    location?: string;
    progress?: number;
    order_date?: string;
    expected_delivery?: string;
    brand?: string;
    floors?: number;
    door_type?: string;
    drive_type?: string;
    capacity?: string;
    remark?: string;
    planned_start?: string;
    planned_end?: string;
    actual_start?: string;
    actual_end?: string;
    notes?: string;
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
  return job;
}
