"use server";

import { createClient } from "@supabase/supabase-js";
import { ricardoKeyOf } from "@/lib/ricardo/job-number";
import { ltCrmKeyOf } from "@/lib/ltcrm/job-number";

/**
 * CRM production gate (owner rule, 2026-11-19): a job may only be added to the
 * Factory ERP once its CRM (LT Elevator or Ricardo, picked by the job-number
 * format) has it at "Production Initiated" or a later stage.
 *
 * Read live from each CRM's secret-gated `erp_job_stage` RPC — deliberately NOT
 * cached, so a job moved to production in the CRM a moment ago passes straight
 * away. The gate fails CLOSED: a number that belongs to neither CRM, a job the
 * CRM doesn't have (or has cancelled / on Hold), or a CRM we can't reach all
 * block the job, each with its own message.
 */

export type CrmName = "LT Elevator CRM" | "Ricardo CRM";

export interface CrmProductionCheck {
  allowed: boolean;
  reason: "ok" | "not_crm_number" | "not_found" | "not_in_production" | "unavailable";
  crm: CrmName | null;
  /** The job's current CRM stage, when the CRM has the job. */
  stageName: string | null;
  /** Ready-to-show sentence explaining the outcome. */
  message: string;
}

interface StageRow {
  key: string;
  full_job_number: string;
  stage_name: string | null;
  in_production: boolean;
}

/** key → row for one CRM; null = that CRM could not be read. */
async function fetchStages(
  env: { url?: string; anonKey?: string; secret?: string },
  keys: string[],
  tag: string,
): Promise<Map<string, StageRow> | null> {
  if (!env.url || !env.anonKey || !env.secret) return null;
  try {
    const supabase = createClient(env.url, env.anonKey);
    const { data, error } = await supabase.rpc("erp_job_stage", {
      p_secret: env.secret,
      p_keys: keys,
    });
    if (error) {
      console.error(`[${tag}] stage feed error:`, error.message);
      return null;
    }
    return new Map(((data ?? []) as StageRow[]).map((r) => [r.key, r]));
  } catch (e) {
    console.error(`[${tag}] stage feed unreachable:`, e);
    return null;
  }
}

function verdict(
  jobNumber: string,
  crm: CrmName,
  rows: Map<string, StageRow> | null,
  key: string,
): CrmProductionCheck {
  if (!rows) {
    return {
      allowed: false,
      reason: "unavailable",
      crm,
      stageName: null,
      message: `Could not reach the ${crm} to check job ${jobNumber}. Please try again in a moment.`,
    };
  }
  const row = rows.get(key);
  if (!row) {
    return {
      allowed: false,
      reason: "not_found",
      crm,
      stageName: null,
      message: `Job ${jobNumber} was not found in the ${crm} (or it is cancelled there). It must be in the CRM and marked Production Initiated first.`,
    };
  }
  if (!row.in_production) {
    return {
      allowed: false,
      reason: "not_in_production",
      crm,
      stageName: row.stage_name,
      message: `Job ${jobNumber} is at "${row.stage_name ?? "no stage"}" in the ${crm}. Move it to Production Initiated in the CRM first.`,
    };
  }
  return {
    allowed: true,
    reason: "ok",
    crm,
    stageName: row.stage_name,
    message: `${crm}: ${row.stage_name}`,
  };
}

/** Batch check — one round trip per CRM. Result is keyed by the job number as passed in. */
export async function checkCrmProductionForJobs(
  jobNumbers: string[],
): Promise<Record<string, CrmProductionCheck>> {
  const out: Record<string, CrmProductionCheck> = {};
  const lt: [string, string][] = [];
  const ricardo: [string, string][] = [];

  for (const jn of jobNumbers) {
    const ltKey = ltCrmKeyOf(jn);
    const rKey = ltKey ? null : ricardoKeyOf(jn);
    if (ltKey) lt.push([jn, ltKey]);
    else if (rKey) ricardo.push([jn, rKey]);
    else {
      out[jn] = {
        allowed: false,
        reason: "not_crm_number",
        crm: null,
        stageName: null,
        message: `"${jn}" is not a CRM job number (expected e.g. IN-WB-5084 or RNLDL-0111), so it cannot be checked against the CRM.`,
      };
    }
  }

  const [ltRows, ricardoRows] = await Promise.all([
    lt.length
      ? fetchStages(
          {
            url: process.env.LTCRM_SUPABASE_URL,
            anonKey: process.env.LTCRM_SUPABASE_ANON_KEY,
            secret: process.env.LTCRM_ERP_SECRET,
          },
          Array.from(new Set(lt.map(([, k]) => k))),
          "ltcrm",
        )
      : null,
    ricardo.length
      ? fetchStages(
          {
            url: process.env.RICARDO_SUPABASE_URL,
            anonKey: process.env.RICARDO_SUPABASE_ANON_KEY,
            secret: process.env.RICARDO_ERP_SECRET,
          },
          Array.from(new Set(ricardo.map(([, k]) => k))),
          "ricardo",
        )
      : null,
  ]);

  for (const [jn, k] of lt) out[jn] = verdict(jn, "LT Elevator CRM", ltRows, k);
  for (const [jn, k] of ricardo) out[jn] = verdict(jn, "Ricardo CRM", ricardoRows, k);
  return out;
}

export async function checkCrmProduction(jobNumber: string): Promise<CrmProductionCheck> {
  const jn = (jobNumber ?? "").trim();
  return (await checkCrmProductionForJobs([jn]))[jn];
}
