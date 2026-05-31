"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Loader2,
  Copy,
  Check,
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ProgramFormModal } from "@/components/programs/program-form-modal";
import { ProgramSketchPanel } from "@/components/programs/program-sketch-panel";
import {
  deleteOperation,
  setOperationAudited,
  type OperationDetail,
  type FamilyVariant,
  type FamilyOption,
} from "@/lib/actions/operations";
import {
  OPERATION_MACHINE_LABELS,
  type ItemCategory,
  type UnitOfMeasurement,
  type ItemType,
} from "@/lib/supabase/types";

interface Props {
  operation: OperationDetail;
  /** Sibling material/finish variants in the same family (incl. this one). */
  variants: FamilyVariant[];
  /** Existing families for the edit/clone form's family-autocomplete. */
  familyOptions: FamilyOption[];
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
}

export function ProgramDetailClient({
  operation,
  variants,
  familyOptions,
  categories,
  units,
  itemRefs,
}: Props) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [audited, setAudited] = useState(!!operation.audited_at);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Inventory-match summary for this program: how many input/output lines are
  // still "to be filled" (no item_id).
  const match = useMemo(() => {
    // Only 'component' lines (real items) are expected to map to inventory.
    // cut_part / tooling / scrap outputs are intentionally not items.
    const all = [...operation.inputs, ...operation.outputs];
    const mappable = all.filter((l) => (l.role ?? "component") === "component");
    const unmatched = mappable.filter((l) => !l.item_id).length;
    const nonItem = all.length - mappable.length;
    return {
      total: mappable.length,
      unmatched,
      matched: mappable.length - unmatched,
      nonItem,
    };
  }, [operation.inputs, operation.outputs]);

  // Unmark immediately; require confirmation before marking audited.
  const requestAudit = () => {
    if (audited) {
      setAudited(false);
      startTransition(async () => {
        const res = await setOperationAudited(operation.id, false);
        if (!res.ok) setAudited(true);
      });
    } else {
      setConfirmOpen(true);
    }
  };

  const confirmAuditYes = () => {
    setAudited(true);
    setConfirmOpen(false);
    startTransition(async () => {
      const res = await setOperationAudited(operation.id, true);
      if (!res.ok) setAudited(false);
    });
  };

  const handleDelete = () => {
    if (
      !confirm(
        `Delete program “${operation.name}”?\n\nThis removes the program and its input/output lines. It does not touch any inventory items.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await deleteOperation(operation.id);
      if (!result.ok) {
        alert(`Could not delete: ${result.error}`);
        return;
      }
      router.push("/programs");
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/programs"
          className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Programs
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{operation.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {operation.code && (
                <span className="font-mono text-xs text-[var(--muted-foreground)]">
                  {operation.code}
                </span>
              )}
              <Badge variant={operation.machine === "assembly_fit" ? "purple" : operation.machine === "cnc_laser" ? "cyan" : "blue"}>
                {OPERATION_MACHINE_LABELS[operation.machine]}
              </Badge>
            </div>
            {operation.description && (
              <p className="text-sm text-[var(--muted-foreground)] mt-2 max-w-2xl">
                {operation.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={audited ? "primary" : "secondary"}
              onClick={requestAudit}
              disabled={isPending}
              className={audited ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
              title={audited ? "Audited — click to unmark" : "Mark this program audited"}
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              {audited ? "Audited" : "Mark audited"}
            </Button>
            <Button variant="secondary" onClick={() => setShowClone(true)}>
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Clone
            </Button>
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Material variants — jump between same-program-different-material
          siblings. Only shown when the family has more than one member. */}
      {variants.length > 1 && (
        <div className="card-surface p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              Material variants ({variants.length})
              {operation.family_key ? ` · ${operation.family_key}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {variants.map((v) => {
              const current = v.id === operation.id;
              const vUnmatched =
                v.input_count +
                v.output_count -
                (v.input_matched + v.output_matched);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    if (!current) router.push(`/programs/${v.id}`);
                  }}
                  title={v.name}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-sm border transition-colors",
                    current
                      ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--accent-foreground)] font-medium cursor-default"
                      : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer",
                  )}
                >
                  {v.audited_at && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                      title="Audited"
                    />
                  )}
                  {v.material_label ?? v.code ?? "Variant"}
                  {vUnmatched > 0 && (
                    <span
                      className="text-[10px] text-amber-600 tabular-nums"
                      title={`${vUnmatched} item(s) need mapping`}
                    >
                      {vUnmatched}⚠
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inventory-match summary banner. */}
      {match.total > 0 && (
        <div
          className={cn(
            "flex items-center gap-2 mb-4 px-4 py-3 rounded-lg border text-sm",
            match.unmatched === 0
              ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
              : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
          )}
        >
          {match.unmatched === 0 ? (
            <>
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All {match.total} item{match.total === 1 ? "" : "s"} are matched to
              inventory.
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{match.unmatched}</strong> of {match.total} item
                {match.total === 1 ? "" : "s"} still need an inventory match.
                Edit the program to link them.
              </span>
            </>
          )}
        </div>
      )}

      {/* Body: lines on the left, sketch on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <LineTable
            title="Inputs"
            subtitle="Consumed per run"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            lines={operation.inputs}
            emptyText="No inputs recorded yet. Edit the program to add what it consumes."
          />
          <LineTable
            title="Outputs"
            subtitle="Produced per run"
            icon={<ArrowUpFromLine className="h-4 w-4 text-blue-700" />}
            lines={operation.outputs}
            emptyText="No outputs recorded yet. Edit the program to add what it produces."
          />
          {operation.notes && (
            <div className="rounded-md border border-[var(--border)] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                Notes
              </h3>
              <p className="text-sm whitespace-pre-wrap">{operation.notes}</p>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-4">
          <ProgramSketchPanel
            operationId={operation.id}
            initialUrl={operation.sketch_url}
            initialFilename={operation.sketch_filename}
            initialUploadedAt={operation.sketch_uploaded_at}
          />
        </div>
      </div>

      {showEdit && (
        <ProgramFormModal
          operation={operation}
          familyOptions={familyOptions}
          categories={categories}
          units={units}
          itemRefs={itemRefs}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            router.refresh();
          }}
        />
      )}

      {showClone && (
        <ProgramFormModal
          cloneSource={operation}
          familyOptions={familyOptions}
          categories={categories}
          units={units}
          itemRefs={itemRefs}
          onClose={() => setShowClone(false)}
          onSaved={(id) => {
            setShowClone(false);
            router.push(`/programs/${id}`);
          }}
        />
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Mark program audited?"
          message={
            <>
              Are you sure all inputs and outputs in{" "}
              <span className="font-medium">{operation.name}</span> are accurate
              and correctly mapped to inventory?
              {match.unmatched > 0 && (
                <span className="block mt-2 text-[var(--warning)]">
                  Heads up: {match.unmatched} item
                  {match.unmatched === 1 ? "" : "s"} still{" "}
                  {match.unmatched === 1 ? "needs" : "need"} an inventory match.
                </span>
              )}
            </>
          }
          confirmLabel="Yes, mark audited"
          cancelLabel="No"
          onConfirm={confirmAuditYes}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function LineTable({
  title,
  subtitle,
  icon,
  lines,
  emptyText,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  lines: OperationDetail["inputs"];
  emptyText: string;
}) {
  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]/40">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          · {subtitle}
        </span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          {lines.length} {lines.length === 1 ? "item" : "items"}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-6 text-xs text-[var(--muted-foreground)] text-center">
          {emptyText}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-[110px] text-right">Qty / run</TableHead>
              <TableHead className="w-[70px]">Unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  {l.item_id ? (
                    <Link
                      href={`/inventory?edit=${l.item_id}`}
                      className="hover:underline"
                    >
                      <span className="font-medium">{l.item_name}</span>
                      {l.item_code && (
                        <span className="ml-2 font-mono text-[11px] text-[var(--muted-foreground)]">
                          {l.item_code}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[var(--foreground)]">
                        {l.label || "(unnamed)"}
                      </span>
                      {l.role === "tooling" ? (
                        <Badge variant="neutral" title="Tool / template — not a product">tool</Badge>
                      ) : l.role === "cut_part" ? (
                        <Badge variant="blue" title="Loose part — cut & fitted into an assembly, never stocked">loose part</Badge>
                      ) : l.role === "scrap" ? (
                        <Badge variant="neutral" title="Scrap / offcut">scrap</Badge>
                      ) : (
                        <Badge variant="warning" title="Finished part with no inventory item yet">needs item</Badge>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.qty_per_run}
                </TableCell>
                <TableCell className="text-[var(--muted-foreground)]">
                  {l.uom || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
