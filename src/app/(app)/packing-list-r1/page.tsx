import { getR1Lists } from "@/lib/actions/packing-list-r1";
import { getJobs } from "@/lib/actions/jobs";
import { LandingClient } from "@/components/packing-list-r1/landing-client";

export const dynamic = "force-dynamic";

export default async function PackingListR1Page() {
  const [lists, jobs] = await Promise.all([getR1Lists(), getJobs()]);
  const slim = jobs.map((j) => ({
    id: j.id,
    job_number: j.job_number,
    customer_name: j.customer_name ?? null,
    brand: j.brand ?? null,
    drive_type: j.drive_type ?? null,
    spec_string: j.spec_string ?? null,
    location: j.location ?? null,
    status: j.status,
    requirement_dispatch_date: j.requirement_dispatch_date ?? null,
  }));
  return <LandingClient lists={lists} jobs={slim} />;
}
