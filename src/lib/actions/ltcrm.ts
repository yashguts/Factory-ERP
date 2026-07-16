"use server";

import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { ltCrmKeyOf } from "@/lib/ltcrm/job-number";
import type { RicardoFinancials, RicardoListSummary } from "./ricardo";

/**
 * Live financials from the LT Elevator CRM (a separate Supabase project).
 *
 * Same contract as the Ricardo feed: the CRM exposes a secret-gated,
 * read-only RPC (erp_job_financials) returning contract value, transport
 * scope and payment sums for a set of normalised job keys. Called at read
 * time — nothing is copied or synced.
 */

interface FeedRow {
  key: string;
  full_job_number: string;
  customer_name: string | null;
  contract_value: number | string | null;
  contract_type: string | null;
  cash_amount: number | string | null;
  transport_mode: string | null;
  transport_amount: number | string | null;
  transport_tbd: boolean;
  is_audited: boolean;
  is_government: boolean;
  received_approved: number | string;
  received_pending: number | string;
  payments: {
    date: string | null;
    amount: number | string;
    mode: string | null;
    reference: string | null;
    bank: string | null;
    status: "approved" | "pending";
  }[];
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchFinancials(key: string): Promise<RicardoFinancials | null> {
  const url = process.env.LTCRM_SUPABASE_URL;
  const anonKey = process.env.LTCRM_SUPABASE_ANON_KEY;
  const secret = process.env.LTCRM_ERP_SECRET;
  // Integration not configured (e.g. fresh local checkout) — hide the panel.
  if (!url || !anonKey || !secret) return null;

  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.rpc("erp_job_financials", {
    p_secret: secret,
    p_keys: [key],
  });
  if (error) {
    console.error("[ltcrm] financial feed error:", error.message);
    return null;
  }

  const row = ((data ?? []) as FeedRow[])[0];
  if (!row) return { found: false };

  return {
    found: true,
    fullJobNumber: row.full_job_number,
    customerName: row.customer_name,
    contractValue: num(row.contract_value),
    contractType: row.contract_type,
    cashAmount: num(row.cash_amount),
    transportMode: row.transport_mode,
    transportAmount: num(row.transport_amount),
    transportTbd: row.transport_tbd,
    isAudited: row.is_audited,
    isGovernment: row.is_government ?? false,
    receivedApproved: num(row.received_approved) ?? 0,
    receivedPending: num(row.received_pending) ?? 0,
    payments: (row.payments ?? []).map((p) => ({
      date: p.date,
      amount: num(p.amount) ?? 0,
      mode: p.mode,
      reference: p.reference,
      bank: p.bank,
      status: p.status,
    })),
  };
}

const getCachedFinancials = unstable_cache(fetchFinancials, ["ltcrm-financials"], {
  revalidate: 60,
  tags: ["ltcrm"],
});

async function fetchFinancialsBatch(
  keys: string[],
): Promise<Record<string, RicardoListSummary> | null> {
  const url = process.env.LTCRM_SUPABASE_URL;
  const anonKey = process.env.LTCRM_SUPABASE_ANON_KEY;
  const secret = process.env.LTCRM_ERP_SECRET;
  if (!url || !anonKey || !secret) return null;

  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.rpc("erp_job_financials", {
    p_secret: secret,
    p_keys: keys,
  });
  if (error) {
    console.error("[ltcrm] financial feed error:", error.message);
    return null;
  }

  const byKey: Record<string, RicardoListSummary> = {};
  for (const row of (data ?? []) as FeedRow[]) {
    byKey[row.key] = {
      found: true,
      contractValue: num(row.contract_value),
      receivedApproved: num(row.received_approved) ?? 0,
      receivedPending: num(row.received_pending) ?? 0,
      transportMode: row.transport_mode,
      transportAmount: num(row.transport_amount),
      transportTbd: row.transport_tbd,
      isAudited: row.is_audited,
      isGovernment: row.is_government ?? false,
    };
  }
  return byKey;
}

const getCachedBatch = unstable_cache(fetchFinancialsBatch, ["ltcrm-financials-batch"], {
  revalidate: 60,
  tags: ["ltcrm"],
});

/**
 * Returns null for non-LT job numbers (no panel), { found: false } when the
 * number looks LT-shaped but the CRM has no matching live job.
 */
export async function getLtCrmFinancials(
  jobNumber: string,
): Promise<RicardoFinancials | null> {
  const key = ltCrmKeyOf(jobNumber);
  if (!key) return null;
  return getCachedFinancials(key);
}

/**
 * Batch lookup for list surfaces: one CRM round trip for the whole page.
 * Result is keyed by the ERP job number as passed in. Non-LT numbers get no
 * entry; LT-shaped numbers with no CRM match get { found: false }.
 * Empty result = integration not configured (render nothing).
 */
export async function getLtCrmFinancialsForJobs(
  jobNumbers: string[],
): Promise<Record<string, RicardoListSummary>> {
  const pairs = jobNumbers
    .map((jn) => [jn, ltCrmKeyOf(jn)] as const)
    .filter((p): p is [string, string] => p[1] !== null);
  if (pairs.length === 0) return {};

  // Sorted + deduped so the cache key is stable across render orders.
  const keys = Array.from(new Set(pairs.map(([, k]) => k))).sort();
  const byKey = await getCachedBatch(keys);
  if (!byKey) return {};

  const out: Record<string, RicardoListSummary> = {};
  for (const [jn, k] of pairs) {
    out[jn] = byKey[k] ?? {
      found: false,
      contractValue: null,
      receivedApproved: 0,
      receivedPending: 0,
      transportMode: null,
      transportAmount: null,
      transportTbd: false,
      isAudited: false,
      isGovernment: false,
    };
  }
  return out;
}
