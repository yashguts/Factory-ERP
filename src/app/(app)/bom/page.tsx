import Link from "next/link";
import { Archive } from "lucide-react";
import { getBomArchiveJobs } from "@/lib/actions/bom-archive";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "BOM — archived snapshot" };

/** Read-only archive of the pre-cutover Job Order BOMs (2026-07-03 snapshot),
 *  kept for the transition period so the factory team can refer to the data
 *  they entered on the old BOM. Live item data is each job's Packing List R1. */
export default async function BomArchivePage() {
  const jobs = await getBomArchiveJobs();
  const capturedOn = jobs[0]?.captured_at
    ? new Date(jobs[0].captured_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div>
      <PageHeader
        icon={<Archive size={18} />}
        title="BOM — archived snapshot"
        meta={`${jobs.length} jobs · frozen ${capturedOn ?? "at the R1 cutover"} · read-only`}
      />
      <p className="text-xs text-[var(--muted-foreground)] mb-4 max-w-2xl">
        This is the old Job Order BOM exactly as it stood before the Packing List R1
        became each job&rsquo;s item list. Nothing here changes anything — it&rsquo;s a
        reference for the transition. The live, editable item data is on each
        job&rsquo;s <span className="font-medium">Packing List R1</span>.
      </p>

      {jobs.length === 0 ? (
        <Card>
          <EmptyState icon={<Archive size={28} />} title="No archived BOMs" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Job No.</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">BOM lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.job_id} className="hover:bg-[var(--muted)]">
                  <TableCell className="font-mono text-xs">
                    <Link href={`/bom/${j.job_id}`} className="text-[var(--primary)] hover:underline">
                      {j.job_number ?? j.job_id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{j.customer_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.lines}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
