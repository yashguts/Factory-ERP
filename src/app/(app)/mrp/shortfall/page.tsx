import { getAdHocShortfall } from "@/lib/actions/mrp";
import { getJobs } from "@/lib/actions/jobs";
import { ShortfallClient } from "@/components/mrp/shortfall-client";

interface Props {
  searchParams: Promise<{ jobs?: string }>;
}

// Ad-hoc shortfall — pick a job or a set of jobs (?jobs=id,id,…) and see the
// combined make + trade shortfall for just those jobs, grouped by category.
// Computed fresh (uncached) on the chosen set; the same MRP math as the table.
export default async function ShortfallPage({ searchParams }: Props) {
  const { jobs: jobsParam } = await searchParams;
  const selected = (jobsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [rows, allJobs] = await Promise.all([getAdHocShortfall(selected), getJobs()]);

  const pickJobs = (allJobs as any[]).map((j) => ({
    id: j.id as string,
    number: (j.job_number as string) ?? "",
    customer: (j.customer_name as string | null) ?? null,
    location: (j.location as string | null) ?? null,
    status: (j.status as string) ?? "",
    date: (j.requirement_dispatch_date as string | null) ?? null,
  }));

  return <ShortfallClient jobs={pickJobs} selected={selected} rows={rows} />;
}
