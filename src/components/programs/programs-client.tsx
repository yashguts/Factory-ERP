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
  Pencil,
  Loader2,
  Check,
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
  setOperationAudited,
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
type AuditFilter = "all" | "pending" | "audited";

export function ProgramsClient({
  initialOperations,
  categories,
  units,
  itemRefs,
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [machineFilter, setMachineFilter] = useState<MachineFilter>("all");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const [showCreate, setShowCreate] = useState(false);

  // Clone (fetch full source then open form in create mode).
  const [cloneSource, setCloneSource] = useState<OperationDetail | null>(null);
  // Quick edit (fetch full source then open form in edit mode).
  const [editSource, setEditSource] = useState<OperationDetail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Audit state, optimistic. Seeded from audited_at; toggling persists in bg.
  const [auditedMap, setAuditedMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const op of initialOperations) m[op.id] = !!op.audited_at;
    return m;
  });
  const auditedCount = useMemo(
    () => Object.values(auditedMap).filter(Boolean).length,
    [auditedMap],
  );

  const allCodes = useMemo(
    () => initialOperations.map((o) => o.code).filter((c): c is string => !!c),
    [initialOperations],
  );
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const op of initialOperations) map[op.machine] = (map[op.machine] ?? 0) + 1;
    return map;
  }, [initialOperations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    return initialOperations.filter((op) => {
      if (machineFilter !== "all" && op.machine !== machineFilter) return false;
      const isAudited = auditedMap[op.id] ?? false;
      if (auditFilter === "pending" && isAudited) return false;
      if (auditFilter === "audited" && !isAudited) return false;
      if (tokens.length === 0) return true;
      const hay = `${op.code ?? ""} ${op.name}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [initialOperations, search, machineFilter, auditFilter, auditedMap]);

  const toggleAudit = async (id: string, next: boolean) => {
    setAuditedMap((m) => ({ ...m, [id]: next })); // optimistic
    const res = await setOperationAudited(id, next);
    if (!res.ok) setAuditedMap((m) => ({ ...m, [id]: !next })); // revert on failure
  };

  const openClone = async (id: string) => {
    setBusyId(id);
    try {
      const d = await getOperationDetail(id);
      if (d) {
        setEditSource(null);
        setCloneSource(d);
        setShowCreate(false);
      }
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = async (id: string) => {
    setBusyId(id);
    try {
      const d = await getOperationDetail(id);
      if (d) {
        setCloneSource(null);
        setEditSource(d);
        setShowCreate(false);
      }
    } finally {
      setBusyId(null);
    }
  };

  const closeModal = () => {
    setShowCreate(false);
    setCloneSource(null);
    setEditSource(null);
  };
  const modalOpen = showCreate || !!cloneSource || !!editSource;

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
            Standard Programs · {initialOperations.length} programs ·{" "}
            <span className="text-green-700 font-medium">
              {auditedCount} audited
            </span>{" "}
            / {initialOperations.length - auditedCount} pending
          </p>
        </div>
        <Button
          onClick={() => {
            setCloneSource(null);
            setEditSource(null);
            setShowCreate(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Program
        </Button>
      </div>

      {/* Search + filters */}
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
          <FilterChip label="All" count={initialOperations.length} active={machineFilter === "all"} onClick={() => setMachineFilter("all")} />
          {OPERATION_MACHINES.map((m) => (
            <FilterChip key={m} label={OPERATION_MACHINE_LABELS[m]} count={counts[m] ?? 0} active={machineFilter === m} onClick={() => setMachineFilter(m)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <FilterChip label="Pending" count={initialOperations.length - auditedCount} active={auditFilter === "pending"} onClick={() => setAuditFilter(auditFilter === "pending" ? "all" : "pending")} />
          <FilterChip label="Audited" count={auditedCount} active={auditFilter === "audited"} onClick={() => setAuditFilter(auditFilter === "audited" ? "all" : "audited")} />
        </div>
      </div>

      {/* Table */}
      <div className="border border-[var(--border)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center" title="Audited">✓</TableHead>
              <TableHead className="w-[190px]">Code</TableHead>
              <TableHead>Program Name</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[80px] text-right">In</TableHead>
              <TableHead className="w-[80px] text-right">Out</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="text-center py-12 text-[var(--muted-foreground)] text-sm">
                  {initialOperations.length === 0 ? "No programs yet." : "No programs match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((op) => {
                const audited = auditedMap[op.id] ?? false;
                return (
                  <TableRow
                    key={op.id}
                    className={cn("cursor-pointer", audited && "bg-green-50/40")}
                    onClick={() => router.push(`/programs/${op.id}`)}
                  >
                    <TableCell className="w-10 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => toggleAudit(op.id, !audited)}
                        title={audited ? "Audited — click to unmark" : "Mark audited"}
                        className={cn(
                          "h-5 w-5 inline-flex items-center justify-center rounded border cursor-pointer",
                          audited
                            ? "bg-green-600 border-green-600 text-white"
                            : "border-[var(--border)] hover:border-green-500",
                        )}
                      >
                        {audited && <Check className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">{op.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{op.name}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", op.machine === "assembly_fit" ? "bg-purple-100 text-purple-700" : op.machine === "cnc_laser" ? "bg-cyan-100 text-cyan-700" : "bg-blue-100 text-blue-700")}>
                        {OPERATION_MACHINE_LABELS[op.machine] ?? op.machine}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">
                      <span className="inline-flex items-center gap-1"><ArrowDownToLine className="h-3.5 w-3.5" />{op.input_count}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-blue-700">
                      <span className="inline-flex items-center gap-1"><ArrowUpFromLine className="h-3.5 w-3.5" />{op.output_count}</span>
                    </TableCell>
                    <TableCell className="w-[80px]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => openEdit(op.id)} disabled={busyId === op.id} title="Quick edit — fill items + quantities" className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50">
                          {busyId === op.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" onClick={() => openClone(op.id)} disabled={busyId === op.id} title="Clone this program" className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {modalOpen && (
        <ProgramFormModal
          operation={editSource}
          cloneSource={editSource ? null : cloneSource}
          suggestedCode={cloneSource && !editSource ? nextCodeInSeries(cloneSource.code ?? "", allCodes) : null}
          categories={categories}
          units={units}
          itemRefs={itemRefs}
          onClose={closeModal}
          onSaved={(id) => {
            const wasEdit = !!editSource;
            closeModal();
            if (wasEdit) router.refresh();
            else router.push(`/programs/${id}`);
          }}
        />
      )}
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
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
