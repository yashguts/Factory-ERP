import { getOpenCrmPaymentEvents } from "@/lib/actions/crm-payment-events";
import { CrmPaymentsClient } from "@/components/jobs/crm-payments-client";

export const metadata = { title: "CRM Payments" };
// The ack subtraction must always be fresh — an acknowledged event may not
// keep blinking. The heavy CRM feed underneath stays 60s-cached regardless.
export const dynamic = "force-dynamic";

export default async function CrmPaymentsPage() {
  const events = await getOpenCrmPaymentEvents();
  return <CrmPaymentsClient events={events} />;
}
