"use server";

import { unstable_cache } from "next/cache";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import {
  predictFromCorpus,
  deriveDoorType,
  type TrainingJob,
  type TrainingLine,
  type BomTargetSpec,
  type BomPrediction,
  type InventoryPool,
} from "@/lib/bom/predict-core";

export type { BomPrediction, BomTargetSpec } from "@/lib/bom/predict-core";

export type BomPredictResult =
  | { ok: true; prediction: BomPrediction }
  | { ok: false; error: string };

interface FlatRel {
  code?: string;
  name?: string;
  uom?: { abbreviation?: string } | { abbreviation?: string }[] | null;
}
function flat<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

/**
 * Training corpus = every job that has a BOM, with its spec + sectioned lines.
 * Cached (revalidates on jobs/bom-lines edits) so a newly-audited job widens the
 * example pool automatically. Pages job_bom_lines (5797 rows > the 1000 cap).
 */
async function _getTrainingCorpusUncached(): Promise<TrainingJob[]> {
  const supabase = createCacheClient();

  const jobs = await fetchAllRanged<{
    id: string;
    job_number: string;
    floors: number | null;
    drive_type: string | null;
    capacity: string | null;
    door_finish: string | null;
    brand: string | null;
  }>((from, to, withCount) =>
    supabase
      .from("jobs")
      .select(
        "id, job_number, floors, drive_type, capacity, door_finish, brand",
        withCount ? { count: "exact" } : {},
      )
      .range(from, to),
  );
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const headers = await fetchAllRanged<{ id: string; job_id: string }>((from, to, withCount) =>
    supabase
      .from("job_bom_headers")
      .select("id, job_id", withCount ? { count: "exact" } : {})
      .range(from, to),
  );
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));

  const lines = await fetchAllRanged<{
    job_bom_id: string;
    category: string;
    item_id: string | null;
    required_quantity: number;
    item: ({ code?: string; name?: string } & FlatRel) | ({ code?: string; name?: string } & FlatRel)[] | null;
  }>((from, to, withCount) =>
    supabase
      .from("job_bom_lines")
      .select(
        "job_bom_id, category, item_id, required_quantity, item:items(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))",
        withCount ? { count: "exact" } : {},
      )
      .not("item_id", "is", null)
      .gt("required_quantity", 0)
      .range(from, to),
  );

  const sectionsByJob = new Map<string, Record<string, TrainingLine[]>>();
  for (const ln of lines) {
    const jobId = jobByHeader.get(ln.job_bom_id);
    if (!jobId || !ln.item_id) continue;
    const item = flat(ln.item);
    const uom = flat(item?.uom);
    const sections = sectionsByJob.get(jobId) ?? {};
    const arr = sections[ln.category] ?? [];
    arr.push({
      item_id: ln.item_id,
      item_code: item?.code ?? "",
      item_name: item?.name ?? "",
      uom: uom?.abbreviation ?? "",
      required_quantity: Number(ln.required_quantity) || 0,
    });
    sections[ln.category] = arr;
    sectionsByJob.set(jobId, sections);
  }

  const corpus: TrainingJob[] = [];
  for (const [jobId, sections] of sectionsByJob) {
    const j = jobById.get(jobId);
    if (!j) continue;
    corpus.push({
      id: j.id,
      job_number: j.job_number,
      spec: {
        floors: j.floors,
        drive_type: j.drive_type,
        capacity: j.capacity,
        door_finish: j.door_finish,
        brand: j.brand,
        door_type: deriveDoorType(sections),
      },
      isComplete: Boolean(sections["RAIL"]),
      sections,
    });
  }
  return corpus;
}

export async function getTrainingCorpus(): Promise<TrainingJob[]> {
  return unstable_cache(_getTrainingCorpusUncached, ["bom-predict-corpus"], {
    revalidate: 1800,
    tags: ["jobs", "bom-lines"],
  })();
}

/**
 * The full door-panel catalogue, keyed by BOM section — so the composer can resolve
 * the exact attribute combo (e.g. a colour×width SKU) even when no past job used it.
 */
async function _getDoorInventoryUncached(): Promise<InventoryPool> {
  const supabase = createCacheClient();
  const items = await fetchAllRanged<{ id: string; name: string }>((from, to, withCount) =>
    supabase
      .from("items")
      .select("id, name", withCount ? { count: "exact" } : {})
      .eq("is_active", true)
      .or("name.ilike.Car Pannel%,name.ilike.Landing Pannel%,name.ilike.Collapsible Gate%")
      .range(from, to),
  );
  const pool: InventoryPool = new Map();
  const add = (sec: string, it: { id: string; name: string }) => {
    const arr = pool.get(sec) ?? [];
    arr.push({ item_id: it.id, item_code: "", item_name: it.name, uom: "", required_quantity: 1 });
    pool.set(sec, arr);
  };
  for (const it of items) {
    const n = (it.name || "").toUpperCase();
    if (/^CAR PANNEL|COLLAPSIBLE GATE/.test(n)) add("Car Door Panel", it);
    if (/^LANDING PANNEL|COLLAPSIBLE GATE/.test(n)) add("Landing Door Panel", it);
  }
  return pool;
}

export async function getDoorInventory(): Promise<InventoryPool> {
  return unstable_cache(_getDoorInventoryUncached, ["bom-predict-door-inventory"], {
    revalidate: 3600,
    tags: ["items"],
  })();
}

/**
 * Predict a draft BOM for a target spec. Read-only; the engineer applies + saves.
 * `excludeJobId` drops the job being edited from the corpus so it never matches
 * itself (matches the leave-one-out backtest; keeps confidence honest).
 */
export async function predictBomFromSpec(
  target: BomTargetSpec,
  excludeJobId?: string | null,
): Promise<BomPredictResult> {
  if (!target.drive_type && target.floors == null && !target.capacity) {
    return { ok: false, error: "Enter at least the drive type, floors, or capacity first." };
  }
  try {
    let corpus = await getTrainingCorpus();
    if (excludeJobId) corpus = corpus.filter((j) => j.id !== excludeJobId);
    if (corpus.length === 0) return { ok: false, error: "No past jobs to learn from yet." };
    const inventory = await getDoorInventory().catch(() => undefined);
    const prediction = predictFromCorpus(target, corpus, inventory);
    return { ok: true, prediction };
  } catch {
    return { ok: false, error: "Could not build a suggestion right now." };
  }
}
