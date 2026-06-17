"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Cog, Check, Pencil, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CabinProgramFormModal } from "@/components/cabin/cabin-program-form-modal";
import {
  setCabinProgramAudited,
  deleteCabinProgram,
  type CabinProgramDetail,
} from "@/lib/actions/cabin-programs";

const MACHINE_LABEL: Record<string, string> = {
  cnc_laser: "Laser cutting", cnc_punch: "Punching", assembly_fit: "Assembly / fit",
};

export function CabinProgramDetailClient({ program }: { program: CabinProgramDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const audited = program.audited_at != null;

  const toggleAudit = async () => {
    setBusy(true);
    const res = await setCabinProgramAudited(program.id, !audited);
    setBusy(false);
    if (res.ok) { toast.success(audited ? "Marked pending" : "Marked audited"); router.refresh(); }
    else toast.error(res.error ?? "Failed");
  };

  const doDelete = async () => {
    setBusy(true);
    const res = await deleteCabinProgram(program.id);
    setBusy(false);
    if (res.ok) { toast.success("Program deleted"); router.push("/cabin-programs"); }
    else toast.error(res.error ?? "Failed");
  };

  return (
    <div>
      <Link href="/cabin-programs" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3">
        <ArrowLeft size={15} /> Cabin Programs
      </Link>

      <PageHeader
        icon={<Cog size={18} />}
        title={program.name}
        meta={
          <span className="inline-flex items-center gap-2">
            {program.code && <span className="font-mono">{program.code}</span>}
            <Badge variant="purple">{program.category}</Badge>
            {program.machine && <span>{MACHINE_LABEL[program.machine] ?? program.machine}</span>}
            {program.machining_time_seconds != null && (
              <span className="inline-flex items-center gap-1"><Clock size={13} /> {Math.round(program.machining_time_seconds / 60)} min</span>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant={audited ? "secondary" : "primary"} onClick={toggleAudit} disabled={busy}>
              <Check size={15} className="mr-1.5" /> {audited ? "Audited" : "Mark audited"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil size={15} className="mr-1.5" /> Edit</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {/* Left: cut-from + outputs */}
        <div className="md:col-span-2 space-y-4">
          <div className="card-surface p-4">
            <div className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">Cut from</div>
            {program.input_sheet_name ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{program.input_sheet_name}</span>
                {program.thickness_mm != null && <Badge variant="blue">{program.thickness_mm}mm</Badge>}
                <span className="text-[var(--muted-foreground)]">× {program.sheets_per_run} / run</span>
              </div>
            ) : (
              <div className="text-sm text-[var(--muted-foreground)]">No sheet selected — set one so Cabin MRP can plan sheets.</div>
            )}
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">Actual sheet is chosen per finish at plan time.</p>
          </div>

          <div className="card-surface overflow-hidden">
            <div className="px-4 py-2.5 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide border-b border-[var(--border)]">Produces</div>
            <Table density="dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Output</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Qty / run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {program.outputs.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <span className="font-medium">{o.family ?? o.name}</span>
                      {o.code && !o.family && <span className="ml-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">{o.code}</span>}
                    </TableCell>
                    <TableCell>
                      {o.finish_varying
                        ? <Badge variant="amber">{o.cabin_type ?? "cabin"} · finish-varying</Badge>
                        : <span className="text-xs text-[var(--muted-foreground)]">fixed item</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.qty_per_run}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {(program.description || program.notes) && (
            <div className="card-surface p-4 text-sm space-y-2">
              {program.description && <div><span className="text-[var(--muted-foreground)]">Description: </span>{program.description}</div>}
              {program.notes && <div><span className="text-[var(--muted-foreground)]">Notes: </span>{program.notes}</div>}
            </div>
          )}
        </div>

        {/* Right: finishes */}
        <div className="card-surface p-4 h-fit">
          <div className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
            Cut in {program.finishes.length} finish{program.finishes.length === 1 ? "" : "es"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {program.finishes.map((f) => (
              <span key={f} className="text-xs px-2.5 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-medium">{f}</span>
            ))}
            {program.finishes.length === 0 && <span className="text-sm text-[var(--muted-foreground)]">None set</span>}
          </div>
        </div>
      </div>

      {editing && (
        <CabinProgramFormModal
          initial={program}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); router.refresh(); }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this cabin program?"
          message={`"${program.name}" will be permanently removed.`}
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
