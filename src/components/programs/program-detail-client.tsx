"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Loader2,
  Copy,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { deleteOperation, type OperationDetail } from "@/lib/actions/operations";
import {
  OPERATION_MACHINE_LABELS,
  type ItemCategory,
  type UnitOfMeasurement,
  type ItemType,
} from "@/lib/supabase/types";

interface Props {
  operation: OperationDetail;
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
}

export function ProgramDetailClient({
  operation,
  categories,
  units,
  itemRefs,
}: Props) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [isPending, startTransition] = useTransition();

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
            <h1 className="text-2xl font-bold">{operation.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {operation.code && (
                <span className="font-mono text-xs text-[var(--muted-foreground)]">
                  {operation.code}
                </span>
              )}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  operation.machine === "assembly_fit"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {OPERATION_MACHINE_LABELS[operation.machine]}
              </span>
            </div>
            {operation.description && (
              <p className="text-sm text-[var(--muted-foreground)] mt-2 max-w-2xl">
                {operation.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
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
