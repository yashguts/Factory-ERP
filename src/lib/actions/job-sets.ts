"use server";

import { unstable_cache, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { getJobScopeOptions, type JobScopeOption } from "@/lib/actions/mrp";
import { getCabinScopeOptions, type CabinScopeOption } from "@/lib/actions/cabin-mrp";

/** Matches no row — an EMPTY resolved scope must stay empty, because the
 *  downstream readers all treat "no ids" as "no selection = all jobs". */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/* ------------------------------------------------------------------ *
 * Named, editable job sets (owner, 2026-07-16).
 *
 * The owner picks a group of Job Orders in the MRP scope picker (e.g.
 * the "Urgent" jobs) and saves it under a name. The set is then one
 * click on EVERY MRP surface: Make/Trade views scope to the member
 * jobs directly (?set=<id> in the URL, resolved server-side so the
 * view always reflects the set's CURRENT membership); Cabin MRP
 * resolves members to cabin jobs by job_number match. A set stores
 * only membership — all demand math stays in the scoped readers.
 * ------------------------------------------------------------------ */

export interface JobSetSummary {
  id: string;
  name: string;
  member_count: number;
}

export type JobSetSaveResult =
  | { ok: true; id: string; updated: boolean }
  | { ok: false; error: string };

/** job_id -> names of the saved sets it belongs to. Drives the set chip on the
 *  Job Orders list (e.g. "Urgent"). Tiny tables, one nested read, 5-min cache
 *  invalidated by every set save/delete via the "job-sets" tag. */
export async function getJobSetMembershipMap(): Promise<Record<string, string[]>> {
  return unstable_cache(
    async () => {
      const supabase = createCacheClient();
      const { data } = await supabase
        .from("job_sets")
        .select("name, job_set_members(job_id)");
      const map: Record<string, string[]> = {};
      for (const s of (data ?? []) as any[]) {
        for (const m of ((s.job_set_members ?? []) as any[])) {
          (map[m.job_id as string] ??= []).push(s.name as string);
        }
      }
      return map;
    },
    ["job-set-membership"],
    { revalidate: 300, tags: ["job-sets"] },
  )();
}

/** All saved sets, for the picker chips. */
export async function getJobSets(): Promise<JobSetSummary[]> {
  return unstable_cache(
    async () => {
      const supabase = createCacheClient();
      const { data } = await supabase
        .from("job_sets")
        .select("id, name, created_at, job_set_members(count)")
        .order("created_at", { ascending: true });
      return ((data ?? []) as any[]).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        member_count: Array.isArray(s.job_set_members)
          ? Number((s.job_set_members[0] as any)?.count ?? 0)
          : 0,
      }));
    },
    ["job-sets"],
    { revalidate: 300, tags: ["job-sets"] },
  )();
}

/** Create a set (or overwrite the members of an existing one with the same
 *  name — names are unique, case/whitespace-insensitive). */
export async function saveJobSet(name: string, jobIds: string[]): Promise<JobSetSaveResult> {
  const clean = (name ?? "").trim();
  if (!clean) return { ok: false, error: "Give the set a name (e.g. Urgent)." };
  if (clean.length > 40) return { ok: false, error: "Set name is too long (max 40 characters)." };
  const ids = [...new Set((jobIds ?? []).filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: "Select at least one job before saving a set." };

  const supabase = await createClient();
  // Exact normalized-name match in JS (the sets table is tiny) — ilike would
  // treat %, _ and * in the typed name as wildcards and could match (and then
  // overwrite) an unrelated set.
  const { data: allSets } = await supabase.from("job_sets").select("id, name");
  const norm = clean.toLowerCase();
  const existing = ((allSets ?? []) as any[]).find(
    (s) => ((s.name as string) ?? "").trim().toLowerCase() === norm,
  );

  let setId: string;
  let updated = false;
  if (existing?.id) {
    setId = existing.id as string;
    updated = true;
    await supabase.from("job_sets").update({ name: clean, updated_at: new Date().toISOString() }).eq("id", setId);
  } else {
    const { data, error } = await supabase.from("job_sets").insert({ name: clean }).select("id").single();
    if (error || !data)
      return {
        ok: false,
        error:
          error?.code === "23505"
            ? `A set named "${clean}" already exists — try saving again to update it.`
            : error?.message ?? "Could not create the set.",
      };
    setId = data.id as string;
  }
  const res = await replaceMembers(setId, ids);
  if (!res.ok) return res;
  revalidateTag("job-sets");
  return { ok: true, id: setId, updated };
}

/** Replace an existing set's members with the given jobs (the picker's
 *  "Update <name>" button). */
export async function updateJobSetMembers(
  setId: string,
  jobIds: string[],
): Promise<JobSetSaveResult> {
  if (!setId) return { ok: false, error: "Missing set id." };
  const ids = [...new Set((jobIds ?? []).filter(Boolean))];
  if (ids.length === 0)
    return { ok: false, error: "A set needs at least one job — delete the set instead." };
  const supabase = await createClient();
  const res = await replaceMembers(setId, ids);
  if (!res.ok) return res;
  await supabase.from("job_sets").update({ updated_at: new Date().toISOString() }).eq("id", setId);
  revalidateTag("job-sets");
  return { ok: true, id: setId, updated: true };
}

export async function deleteJobSet(
  setId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!setId) return { ok: false, error: "Missing set id." };
  const supabase = await createClient();
  const { error } = await supabase.from("job_sets").delete().eq("id", setId);
  if (error) return { ok: false, error: error.message };
  revalidateTag("job-sets");
  return { ok: true };
}

/** Replace a set's members INSERT-FIRST so a mid-write failure can never
 *  strand the set empty (a delete-first swap that fails on insert would).
 *  Draft ids come from long-open picker panels, so re-validate them against
 *  jobs — a job deleted in another tab silently drops out instead of failing
 *  the whole write with an FK error. */
async function replaceMembers(
  setId: string,
  jobIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: live, error: valErr } = await supabase.from("jobs").select("id").in("id", jobIds);
  if (valErr) return { ok: false, error: valErr.message };
  const keep = ((live ?? []) as any[]).map((j) => j.id as string);
  if (keep.length === 0)
    return { ok: false, error: "None of the selected jobs exist any more — reopen the picker and reselect." };
  const { error: insErr } = await supabase
    .from("job_set_members")
    .upsert(keep.map((job_id) => ({ set_id: setId, job_id })), { ignoreDuplicates: true });
  if (insErr) return { ok: false, error: insErr.message };
  // Prune what's no longer selected — if THIS fails the set holds a superset,
  // never nothing.
  const { error: delErr } = await supabase
    .from("job_set_members")
    .delete()
    .eq("set_id", setId)
    .not("job_id", "in", `(${keep.join(",")})`);
  if (delErr) return { ok: false, error: delErr.message };
  return { ok: true };
}

/* ------------------------- scope resolution ------------------------- */

/** Everything a Make/Trade MRP page needs to render the scope picker and
 *  compute its plan. `?set=` wins over `?jobs=` (the picker only ever
 *  writes one of the two). */
export interface JobScopeData {
  options: JobScopeOption[];
  sets: JobSetSummary[];
  activeSet: { id: string; name: string } | null;
  /** The resolved scope — set members when a set is active, else ?jobs=. */
  selectedIds: string[];
}

const _getSetWithMembers = async (
  setId: string,
): Promise<{ id: string; name: string; jobIds: string[] } | null> =>
  unstable_cache(
    async (id: string) => {
      const supabase = createCacheClient();
      const { data } = await supabase
        .from("job_sets")
        .select("id, name, job_set_members(job_id)")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        name: data.name as string,
        jobIds: (((data as any).job_set_members ?? []) as any[]).map((m) => m.job_id as string),
      };
    },
    ["job-set-members"],
    { revalidate: 300, tags: ["job-sets"] },
  )(setId);

export async function getJobScopeData(
  jobsParam?: string,
  setParam?: string,
): Promise<{ scope: JobScopeData; jobIds: string[] }> {
  const [options, sets] = await Promise.all([getJobScopeOptions(), getJobSets()]);
  if (setParam) {
    const set = await _getSetWithMembers(setParam);
    if (set) {
      return {
        scope: { options, sets, activeSet: { id: set.id, name: set.name }, selectedIds: set.jobIds },
        // NIL sentinel: a set emptied by job deletion (FK cascade) must render
        // an EMPTY plan — the readers treat [] as "no selection = all jobs".
        jobIds: set.jobIds.length ? set.jobIds : [NIL_UUID],
      };
    }
  }
  const jobIds = (jobsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { scope: { options, sets, activeSet: null, selectedIds: jobIds }, jobIds };
}

/** Cabin twin: resolve a set's Job Orders to cabin jobs by job_number
 *  (same trim+lowercase link the Car Linton fold uses). */
export interface CabinScopeData {
  options: CabinScopeOption[];
  sets: JobSetSummary[];
  /** matched = how many of the set's job orders have a cabin job. */
  activeSet: { id: string; name: string; matched: number } | null;
  selectedIds: string[];
}

export async function getCabinScopeData(
  jobsParam?: string,
  setParam?: string,
): Promise<{ scope: CabinScopeData; cabinJobIds: string[] }> {
  const [options, sets] = await Promise.all([getCabinScopeOptions(), getJobSets()]);
  if (setParam) {
    const set = await _getSetWithMembers(setParam);
    if (set) {
      const cabinJobIds = await unstable_cache(
        async (id: string, memberIds: string[]) => {
          if (memberIds.length === 0) return [] as string[];
          const supabase = createCacheClient();
          const [{ data: jobs }, cjobs] = await Promise.all([
            supabase.from("jobs").select("job_number").in("id", memberIds),
            // Paged — cabin_jobs grows unbounded (PostgREST 1000-row cap).
            fetchAllRanged<{ id: string; job_number: string }>((from, to, withCount) =>
              supabase
                .from("cabin_jobs")
                .select("id, job_number", withCount ? { count: "exact" } : {})
                .range(from, to),
            ),
          ]);
          const wanted = new Set(
            ((jobs ?? []) as any[])
              .map((j) => ((j.job_number as string) ?? "").trim().toLowerCase())
              .filter(Boolean),
          );
          return cjobs
            .filter((c) => wanted.has((c.job_number ?? "").trim().toLowerCase()))
            .map((c) => c.id);
        },
        ["job-set-cabin-resolve"],
        { revalidate: 300, tags: ["job-sets", "cabin-jobs", "jobs"] },
      )(set.id, set.jobIds);
      // NIL-uuid sentinel: an empty scope must mean "no cabin jobs", not the
      // readers' "no selection = all eligible jobs" default.
      const effective = cabinJobIds.length ? cabinJobIds : [NIL_UUID];
      return {
        scope: {
          options,
          sets,
          activeSet: { id: set.id, name: set.name, matched: cabinJobIds.length },
          selectedIds: cabinJobIds,
        },
        cabinJobIds: effective,
      };
    }
  }
  const cabinJobIds = (jobsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { scope: { options, sets, activeSet: null, selectedIds: cabinJobIds }, cabinJobIds };
}
