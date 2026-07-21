"use server";

import { revalidatePath, unstable_cache } from "next/cache";
import { createClient as createExternalClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { getJobs } from "@/lib/actions/jobs";
import { ricardoKeyOf } from "@/lib/ricardo/job-number";
import { ltCrmKeyOf } from "@/lib/ltcrm/job-number";

/**
 * Live payment-event notifications from both CRMs (Ricardo + LT Elevator).
 *
 * Each CRM exposes a second secret-gated, read-only RPC
 * (erp_recent_payment_events) — same contract as erp_job_financials — that
 * returns payment lifecycle events (recorded / approved / denied / updated)
 * since a watermark. We poll it at read time, keep only the events that
 * change what the ERP shows (owner's call 2026-07-04: only approved money
 * appears anywhere, so: newly-approved payments plus post-hoc edits of
 * still-approved ones), match them to ERP jobs by the shared normalised key,
 * and subtract the globally-acknowledged ids stored in
 * crm_payment_event_acks (068). Whatever is left blinks in the sidebar.
 */

export interface CrmPaymentEvent {
  /**
   * Globally unique ack key. Approved events: "<source>:<payment-id>:approved:
   * <approved_at-epoch>" (the epoch versions it, so a re-approval after a
   * revert is a new, un-acknowledged event). Post-approval edits: the bare
   * "<source>:<log-row-id>".
   */
  id: string;
  source: "ricardo" | "ltcrm";
  kind: "approved" | "updated";
  /** When the event happened in the CRM (ISO timestamptz). */
  eventAt: string;
  /** Full job number as the CRM writes it (e.g. "RNLDL-0111", "IN-WB-4110"). */
  crmJobNumber: string;
  erpJobId: string;
  erpJobNumber: string;
  customerName: string | null;
  amount: number;
  dateReceived: string | null;
  mode: string | null;
  reference: string | null;
  bank: string | null;
}

interface EventFeedRow {
  event_id: string;
  event_kind: string;
  event_at: string;
  key: string;
  full_job_number: string;
  customer_name: string | null;
  amount: number | string;
  date_received: string | null;
  mode: string | null;
  reference: string | null;
  bank: string | null;
  current_status: string;
}

/** A feed event before it is matched to an ERP job. */
interface RawCrmPaymentEvent extends Omit<CrmPaymentEvent, "erpJobId" | "erpJobNumber"> {
  key: string;
}

// How far back the feed looks. Wide enough to survive a week-plus factory
// closure (a payment approved just before Diwali still blinks on reopening);
// the ack table (no TTL) keeps re-entering events subtracted, and the RPC's
// approved-only output stays well under the 500-row cap at observed volumes.
const LOOKBACK_DAYS = 14;
// Hard ceiling per CRM poll — matches the RPC's own clamp. Passed explicitly so
// a busy week can't fall back to the RPC's lower default.
const EVENT_LIMIT = 500;
// A hung CRM must not stall the app: server actions share a serial queue, and
// this feed is polled every 60s, so cap each RPC round-trip.
const RPC_TIMEOUT_MS = 8000;

/** Stable per-UTC-day watermark so the cached CRM fetches keep a stable key. */
function sinceIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS);
  return d.toISOString();
}

function mapRows(source: "ricardo" | "ltcrm", rows: EventFeedRow[]): RawCrmPaymentEvent[] {
  return rows
    // Only events that change the ERP's approved-money view. 'recorded'
    // (pending) and 'denied' stay hidden per the no-pending-figures rule.
    .filter(
      (r) =>
        r.event_kind === "approved" ||
        (r.event_kind === "updated" && r.current_status === "approved"),
    )
    .map((r) => ({
      id: `${source}:${r.event_id}`,
      source,
      kind: r.event_kind === "approved" ? ("approved" as const) : ("updated" as const),
      eventAt: r.event_at,
      key: r.key,
      crmJobNumber: r.full_job_number,
      customerName: r.customer_name,
      amount: Number(r.amount) || 0,
      dateReceived: r.date_received,
      mode: r.mode,
      reference: r.reference,
      bank: r.bank,
    }));
}

async function fetchRicardoEvents(since: string): Promise<RawCrmPaymentEvent[]> {
  const url = process.env.RICARDO_SUPABASE_URL;
  const anonKey = process.env.RICARDO_SUPABASE_ANON_KEY;
  const secret = process.env.RICARDO_ERP_SECRET;
  // Integration not configured (e.g. fresh local checkout) — no events.
  if (!url || !anonKey || !secret) return [];

  const supabase = createExternalClient(url, anonKey);
  const { data, error } = await supabase
    .rpc("erp_recent_payment_events", {
      p_secret: secret,
      p_since: since,
      p_limit: EVENT_LIMIT,
    })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  if (error) {
    console.error("[ricardo] payment events feed error:", error.message);
    return [];
  }
  return mapRows("ricardo", (data ?? []) as EventFeedRow[]);
}

async function fetchLtCrmEvents(since: string): Promise<RawCrmPaymentEvent[]> {
  const url = process.env.LTCRM_SUPABASE_URL;
  const anonKey = process.env.LTCRM_SUPABASE_ANON_KEY;
  const secret = process.env.LTCRM_ERP_SECRET;
  if (!url || !anonKey || !secret) return [];

  const supabase = createExternalClient(url, anonKey);
  const { data, error } = await supabase
    .rpc("erp_recent_payment_events", {
      p_secret: secret,
      p_since: since,
      p_limit: EVENT_LIMIT,
    })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  if (error) {
    console.error("[ltcrm] payment events feed error:", error.message);
    return [];
  }
  return mapRows("ltcrm", (data ?? []) as EventFeedRow[]);
}

const getCachedRicardoEvents = unstable_cache(fetchRicardoEvents, ["ricardo-payment-events"], {
  revalidate: 60,
  tags: ["ricardo"],
});
const getCachedLtEvents = unstable_cache(fetchLtCrmEvents, ["ltcrm-payment-events"], {
  revalidate: 60,
  tags: ["ltcrm"],
});

/**
 * Every unacknowledged CRM payment event that maps to an ERP job, newest
 * first. The CRM fetches are cached 60s (shared across all pollers); the tiny
 * ack-subtraction read is always fresh so an acknowledge clears the blink on
 * the very next poll.
 */
export async function getOpenCrmPaymentEvents(): Promise<CrmPaymentEvent[]> {
  const since = sinceIso();
  const [ricardo, lt, jobs] = await Promise.all([
    getCachedRicardoEvents(since),
    getCachedLtEvents(since),
    getJobs(),
  ]);

  // ERP job lookup by normalised CRM key (the two keyspaces are disjoint).
  const byKey = new Map<string, { id: string; job_number: string }>();
  for (const j of jobs) {
    const k = ricardoKeyOf(j.job_number) ?? ltCrmKeyOf(j.job_number);
    if (k && !byKey.has(k)) byKey.set(k, { id: j.id, job_number: j.job_number });
  }

  const candidates: CrmPaymentEvent[] = [];
  for (const e of [...ricardo, ...lt]) {
    const erp = byKey.get(e.key);
    if (!erp) continue; // CRM job the ERP doesn't carry — nothing to notify on
    const { key: _key, ...rest } = e;
    candidates.push({ ...rest, erpJobId: erp.id, erpJobNumber: erp.job_number });
  }
  if (candidates.length === 0) return [];

  // Subtract acknowledged ids. Chunked .in() keeps the query URL short and
  // stays under the PostgREST row cap no matter how big the ack table grows.
  const supabase = createCacheClient();
  const acked = new Set<string>();
  for (let i = 0; i < candidates.length; i += 100) {
    const chunk = candidates.slice(i, i + 100);
    const { data, error } = await supabase
      .from("crm_payment_event_acks")
      .select("event_id")
      .in(
        "event_id",
        chunk.map((c) => c.id),
      );
    // Fail quiet: if the acks read fails we must NOT treat everything as
    // unacknowledged (that re-blinks already-cleared events and can't be
    // cleared). Skip this cycle; the next 60s poll retries.
    if (error) {
      console.error("[crm-payments] ack subtraction failed:", error.message);
      return [];
    }
    for (const a of data ?? []) acked.add(a.event_id as string);
  }

  return candidates
    .filter((c) => !acked.has(c.id))
    .sort((a, b) => b.eventAt.localeCompare(a.eventAt));
}

/**
 * Acknowledge payment events (one row per event id; global, like Status
 * Alerts). Idempotent — an id acknowledged on another device just upserts
 * into the same row.
 */
export async function acknowledgeCrmPaymentEvents(
  events: { id: string; source: "ricardo" | "ltcrm"; erpJobNumber: string }[],
  operator?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (events.length === 0) return { ok: true };
  const supabase = await createClient();
  const rows = events.map((e) => ({
    event_id: e.id,
    source: e.source,
    job_number: e.erpJobNumber,
    acknowledged_by: operator?.trim() || "unknown",
  }));
  const { error } = await supabase
    .from("crm_payment_event_acks")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/jobs/crm-payments");
  return { ok: true };
}
