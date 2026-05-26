"use server";

import { createClient } from "@/lib/supabase/server";
import type { JobStatus } from "@/lib/supabase/types";

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
