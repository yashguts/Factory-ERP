"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import type { ColumnMatchResult, JobImportResult, ParsedJobRow } from "@/lib/import/types";

export async function resolveColumnMapping(
  columns: { index: number; label: string }[]
): Promise<ColumnMatchResult[]> {
  const supabase = await createClient();

  // Fetch all items with lookup_key
  const { data: items, error } = await supabase
    .from("items")
    .select("id, code, name, lookup_key")
    .eq("is_active", true);

  if (error) throw error;

  // Build lookup map: lowercase lookup_key → item
  const lookupMap = new Map<string, { id: string; code: string; name: string }>();
  for (const item of items ?? []) {
    if (item.lookup_key) {
      lookupMap.set(item.lookup_key.toLowerCase().trim(), {
        id: item.id,
        code: item.code,
        name: item.name,
      });
    }
  }

  // Also check for existing column map entries
  const { data: existingMap } = await supabase
    .from("target_column_map")
    .select("column_index, item_id, item_lookup_key");

  const existingMapByIndex = new Map<number, { item_id: string | null; item_lookup_key: string | null }>();
  for (const entry of existingMap ?? []) {
    existingMapByIndex.set(entry.column_index, entry);
  }

  return columns.map((col) => {
    // First check existing saved mapping
    const existing = existingMapByIndex.get(col.index);
    if (existing?.item_id) {
      const item = (items ?? []).find((i) => i.id === existing.item_id);
      if (item) {
        return {
          column_index: col.index,
          column_label: col.label,
          item_id: item.id,
          item_code: item.code,
          item_name: item.name,
          match_status: "matched" as const,
        };
      }
    }

    // Then try exact match on lookup_key
    const labelLower = col.label.toLowerCase().trim();
    const match = lookupMap.get(labelLower);
    if (match) {
      return {
        column_index: col.index,
        column_label: col.label,
        item_id: match.id,
        item_code: match.code,
        item_name: match.name,
        match_status: "matched" as const,
      };
    }

    return {
      column_index: col.index,
      column_label: col.label,
      item_id: null,
      item_code: null,
      item_name: null,
      match_status: "unmatched" as const,
    };
  });
}

export async function saveColumnMapping(
  mappings: { column_index: number; column_label: string; item_id: string | null; item_lookup_key: string | null }[]
) {
  const supabase = await createClient();

  // Delete existing mappings for these columns
  const indices = mappings.map((m) => m.column_index);
  await supabase.from("target_column_map").delete().in("column_index", indices);

  // Insert new mappings
  const rows = mappings.map((m) => ({
    column_index: m.column_index,
    column_label: m.column_label,
    item_id: m.item_id,
    item_lookup_key: m.item_lookup_key,
    is_active: true,
  }));

  if (rows.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from("target_column_map").insert(batch);
      if (error) throw error;
    }
  }
}

export async function validateJobImport(
  jobs: ParsedJobRow[]
): Promise<{ job: ParsedJobRow; status: "new" | "update" | "error"; error?: string }[]> {
  const supabase = await createClient();

  const jobNumbers = jobs.map((j) => j.job_number);
  const { data: existingJobs } = await supabase
    .from("jobs")
    .select("job_number")
    .in("job_number", jobNumbers);

  const existingSet = new Set((existingJobs ?? []).map((j) => j.job_number));

  return jobs.map((job) => {
    if (!job.job_number) {
      return { job, status: "error" as const, error: "Missing job number" };
    }
    if (existingSet.has(job.job_number)) {
      return { job, status: "update" as const };
    }
    return { job, status: "new" as const };
  });
}

export async function executeJobImport(
  jobs: ParsedJobRow[],
  bomData: { jobNumber: string; items: { itemId: string; quantity: number; colIndex: number }[] }[]
): Promise<JobImportResult> {
  const supabase = await createClient();
  const result: JobImportResult = {
    total_jobs: jobs.length,
    created: 0,
    updated: 0,
    bom_lines_created: 0,
    errors: [],
  };

  // Build BOM data lookup
  const bomByJob = new Map<string, { itemId: string; quantity: number; colIndex: number }[]>();
  for (const entry of bomData) {
    bomByJob.set(entry.jobNumber, entry.items);
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      // Check if job exists
      const { data: existing } = await supabase
        .from("jobs")
        .select("id")
        .eq("job_number", job.job_number)
        .single();

      let jobId: string;

      if (existing) {
        // Update existing job
        const { error } = await supabase
          .from("jobs")
          .update({
            customer_name: job.customer_name || null,
            spec_string: job.spec_string || null,
            door_finish: job.door_finish || null,
            location: job.location || null,
            progress: job.progress,
            order_date: job.order_date,
            expected_delivery: job.expected_delivery,
            brand: job.brand,
            floors: job.floors,
            door_type: job.door_type,
            drive_type: job.drive_type,
            capacity: job.capacity,
            remark: job.remark || null,
          })
          .eq("id", existing.id);

        if (error) {
          result.errors.push({ row: i + 1, message: `Update job ${job.job_number}: ${error.message}` });
          continue;
        }
        jobId = existing.id;
        result.updated++;
      } else {
        // Create new job
        const { data: newJob, error } = await supabase
          .from("jobs")
          .insert({
            job_number: job.job_number,
            customer_name: job.customer_name || null,
            spec_string: job.spec_string || null,
            door_finish: job.door_finish || null,
            location: job.location || null,
            progress: job.progress,
            order_date: job.order_date,
            expected_delivery: job.expected_delivery,
            brand: job.brand,
            floors: job.floors,
            door_type: job.door_type,
            drive_type: job.drive_type,
            capacity: job.capacity,
            remark: job.remark || null,
          })
          .select("id")
          .single();

        if (error || !newJob) {
          result.errors.push({ row: i + 1, message: `Create job ${job.job_number}: ${error?.message ?? "unknown"}` });
          continue;
        }
        jobId = newJob.id;
        result.created++;
      }

      // Handle BOM lines
      const bomItems = bomByJob.get(job.job_number);
      if (bomItems && bomItems.length > 0) {
        // Find or create BOM header for this job
        let { data: header } = await supabase
          .from("job_bom_headers")
          .select("id")
          .eq("job_id", jobId)
          .limit(1)
          .single();

        if (!header) {
          const { data: newHeader, error: hErr } = await supabase
            .from("job_bom_headers")
            .insert({ job_id: jobId, quantity: 1 })
            .select("id")
            .single();

          if (hErr || !newHeader) {
            result.errors.push({ row: i + 1, message: `BOM header for ${job.job_number}: ${hErr?.message ?? "unknown"}` });
            continue;
          }
          header = newHeader;
        }

        // Delete existing BOM lines (full refresh)
        await supabase.from("job_bom_lines").delete().eq("job_bom_id", header.id);

        // Insert new BOM lines in batches
        const lines = bomItems.map((item, idx) => ({
          job_bom_id: header!.id,
          item_id: item.itemId,
          required_quantity: item.quantity,
          issued_quantity: 0,
          wastage_percent: 0,
          sort_order: idx,
          source_col_index: item.colIndex,
        }));

        const BATCH = 200;
        for (let b = 0; b < lines.length; b += BATCH) {
          const batch = lines.slice(b, b + BATCH);
          const { error: lErr } = await supabase.from("job_bom_lines").insert(batch);
          if (lErr) {
            result.errors.push({ row: i + 1, message: `BOM lines for ${job.job_number}: ${lErr.message}` });
            break;
          }
          result.bom_lines_created += batch.length;
        }
      }
    } catch (e) {
      result.errors.push({
        row: i + 1,
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  revalidateTag("jobs");
  revalidateTag("bom-lines");
  return result;
}
