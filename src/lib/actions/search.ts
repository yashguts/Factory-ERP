"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { searchItems, type SearchableItem } from "@/lib/actions/items";

/**
 * Global search (the Ctrl+K palette): one round trip that fans out to
 * jobs + items + programs in parallel and returns small grouped results.
 */

export interface GlobalSearchResult {
  jobs: {
    id: string;
    job_number: string;
    customer_name: string | null;
    location: string | null;
    status: string;
  }[];
  items: SearchableItem[];
  programs: {
    id: string;
    name: string;
    code: string | null;
    machine: string;
  }[];
}

/** PostgREST .or() treats , ( ) specially — strip them from user input. */
function sanitize(q: string): string {
  return q.replace(/[,()%]/g, " ").trim();
}

export async function globalSearch(query: string): Promise<GlobalSearchResult> {
  const q = sanitize(query);
  if (!q) return { jobs: [], items: [], programs: [] };

  const supabase = createCacheClient();
  const like = `%${q}%`;

  const [jobsRes, items, programsRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_number, customer_name, location, status")
      .or(
        `job_number.ilike.${like},customer_name.ilike.${like},location.ilike.${like}`,
      )
      .order("created_at", { ascending: false })
      .limit(6),
    searchItems(q, undefined, 8),
    supabase
      .from("operations")
      .select("id, name, code, machine")
      .eq("is_active", true)
      .or(`name.ilike.${like},code.ilike.${like}`)
      .order("name")
      .limit(6),
  ]);

  return {
    jobs: (jobsRes.data ?? []) as GlobalSearchResult["jobs"],
    items,
    programs: (programsRes.data ?? []) as GlobalSearchResult["programs"],
  };
}
