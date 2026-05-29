"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Cog,
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  Loader2,
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
import { cn } from "@/lib/utils";
import { ProgramFormModal } from "@/components/programs/program-form-modal";
import {
  getOperationDetail,
  type OperationListRow,
  type OperationDetail,
} from "@/lib/actions/operations";
import { nextCodeInSeries } from "@/lib/inventory/next-code";
import {
  OPERATION_MACHINE_LABELS,
  OPERATION_MACHINES,
  type OperationMachine,
  type ItemCategory,
  type UnitOfMeasurement,
  type ItemType,
} from "@/lib/supabase/types";

interface Props {
  initialOperations: OperationListRow[];
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
}

type MachineFilter = "all" | OperationMachine;

export function ProgramsClient({
  initialOperations,
  categories,
  units,
  itemRefs,
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [machineFilter, setMachineFilter] = useState<MachineFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  // Clone: the full source operation (fetched on demand) + the row being fetched.
  const [cloneSource, setCloneSource] = useState<OperationDetail | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  const allCodes = useMemo(
    () =>
      initialOperations
        .map((o) => o.code)
        .filter((c): c is string => !!c),
    [initialOperations],
  );

  const handleClone = async (id: string) => {
    setCloningId(id);
    try {
      const detail = await getOperationDetail(id);
      if (detail) {
        setCloneSource(detail);
        setShowCreate(true);
      }
    } finally {
      setCloningId(null);
    }
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const op of initialOperations) {
      map[op.machine] = (map[op.machine] ?? 0) + 1;
    }
    return map;
  }, [initialOperations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    return initialOperations.filter((op) => {
      if (machineFilter !== "all" && op.machine !== machineFilter) return false;
      if (tokens.length === 0) return true;
      const hay = `${op.code ?? ""} ${op.name}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [initialOperations, search, machineFilter]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cog className="h-6 w-6 text-[var(--muted-foreground)]" />
            Programs
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Cutting &amp; assembly operations ·{" "}
            {initialOperations.length === 1
              ? "1 program"
              : `${initialOperations.length} programs`}
          </p>
        </div>
        <Button
          onClick={() => {
            setCloneSource(null);
            setShowCreate(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Program
        </Button>
      </div>

      {/* Search + type filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or name..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <FilterChip
            label="All"
            count={initialOperations.length}
            active={machineFilter === "all"}
            onClick={() => setMachineFilter("all")}
          />
          {OPERATION_MACHINES.map((m) => (
            <FilterChip
              key={m}
              label={OPERATION_MACHINE_LABELS[m]}
              count={counts[m] ?? 0}
              active={machineFilter === m}
              onClick={() => setMachineFilter(m)}
            />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-[var(--border)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[190px]">Code</TableHead>
              <TableHead>Program Name</TableHead>
              <TableHead className="w-[130px]">Type</TableHead>
              <TableHead className="w-[100px] text-right">Inputs</TableHead>
              <TableHead className="w-[100px] text-right">Outputs</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center py-12">
                  <div className="text-[var(--muted-foreground)]">
                    {initialOperations.length === 0 ? (
                      <>
                        <Cog className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium">No programs yet</p>
                        <p className="text-xs mt-1">
                          Add your first program — what it consumes and what it
                          produces.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm">No programs match your filters.</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((op) => (
                <TableRow
                  key={op.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/programs/${op.id}`)}
                >
                  <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">
                    {op.code ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{op.name}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                        op.machine === "assembly_fit"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700",
                      )}
                    >
                      {OPERATION_MACHINE_LABELS[op.machine] ?? op.machine}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 text-[var(--muted-foreground)]">
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      {op.input_count}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 text-blue-700">
                      <ArrowUpFromLine className="h-3.5 w-3.5" />
                      {op.output_count}
                    </span>
                  </TableCell>
                  <TableCell
                    className="w-10 px-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleClone(op.id)}
                      disabled={cloningId === op.id}
                      title="Clone this program — pre-fills a new program with the same type, inputs and outputs"
                      className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50"
                    >
                      {cloningId === op.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {showCreate && (
        <ProgramFormModal
          cloneSource={cloneSource}
          suggestedCode={
            cloneSource
              ? nextCodeInSeries(cloneSource.code ?? "", allCodes)
              : null
          }
          categories={categories}
          units={units}
          itemRefs={itemRefs}
          onClose={() => {
            setShowCreate(false);
            setCloneSource(null);
          }}
          onSaved={(id) => {
            setShowCreate(false);
            setCloneSource(null);
            router.push(`/programs/${id}`);
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md text-sm border cursor-pointer transition-colors",
        active
          ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
      )}
    >
      {label}
      <span className="text-[11px] opacity-70 tabular-nums">{count}</span>
    </button>
  );
}
