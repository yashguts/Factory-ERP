"use server";

import { getOpenCrmPaymentEvents } from "@/lib/actions/crm-payment-events";

/**
 * Small reads for the CRM payment notification surfaces — the sidebar badge
 * count and the per-job "new payment" markers. Lives in its own "use server"
 * file (only async exports) so CLIENT components (Sidebar, jobs list, money
 * panel) can import it without dragging crm-payment-events.ts's
 * unstable_cache consts into the client-action graph (same split as
 * status-alert-count.ts).
 */
export async function getCrmPaymentEventCount(): Promise<number> {
  return (await getOpenCrmPaymentEvents()).length;
}

/** Distinct ERP job numbers with unacknowledged payment events. */
export async function getCrmPaymentEventJobs(): Promise<string[]> {
  const events = await getOpenCrmPaymentEvents();
  return Array.from(new Set(events.map((e) => e.erpJobNumber)));
}
