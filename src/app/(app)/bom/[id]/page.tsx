import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft, ExternalLink } from "lucide-react";
import { getBomArchive } from "@/lib/actions/bom-archive";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";

/** One job's archived (pre-cutover) BOM — read-only, grouped by the old section
 *  names, exactly as the factory team last saved it on the Job Order form. */
export default async function BomArchiveJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await getBomArchive(id);
  if (!view) notFound();

  const capturedOn = view.captured_at
    ? new Date(view.captured_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div>
      <Link
        href="/bom"
        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to BOM archive
      </Link>

      <PageHeader
        icon={<Archive size={18} />}
        title={`Old BOM — Job ${view.job_number ?? ""}`}
        subtitle={view.customer_name ?? undefined}
        meta={`${view.totalLines} lines · frozen ${capturedOn ?? "at the R1 cutover"} · read-only`}
        actions={
          <Link
            href={`/jobs/${view.job_id}/items`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--muted)]"
            title="The job's live, editable item list"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Live Packing List R1
          </Link>
        }
      />

      <div className="space-y-4">
        {view.sections.map((s) => (
          <Card key={s.category} className="overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/40 text-xs font-semibold uppercase tracking-wide">
              {s.category}
              <span className="ml-2 font-normal normal-case text-[var(--muted-foreground)]">
                {s.lines.length} line{s.lines.length === 1 ? "" : "s"}
              </span>
            </div>
            <Table density="dense">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right w-28">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">{l.code ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-medium">{l.name ?? l.value_text ?? "—"}</span>
                      {l.variant && <span className="ml-2 text-xs text-[var(--muted-foreground)]">({l.variant})</span>}
                      {l.name && l.value_text && (
                        <span className="ml-2 text-xs text-[var(--muted-foreground)]">{l.value_text}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.qty}
                      {l.uom ? <span className="ml-1 text-xs text-[var(--muted-foreground)]">{l.uom}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
      </div>
    </div>
  );
}
