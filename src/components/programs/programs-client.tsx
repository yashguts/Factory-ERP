"use client";

import { Fragment, useMemo, useState } from "react";
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
  ChevronRight,
  ChevronDown,
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
type LabelFilter = "all" | string;

function machineChip(machine: OperationMachine) {
  return cn(
    "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
    machine === "assembly_fit"
      ? "bg-purple-100 text-purple-700"
      : machine === "cnc_laser"
        ? "bg-cyan-100 text-cyan-700"
        : "bg-blue-100 text-blue-700",
  );
}

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
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [cloneSource, setCloneSource] = useState<OperationDetail | null>(null);
  const [editSource, setEditSource] = useState<OperationDetail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [auditedMap, setAuditedMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const op of initialOperations) m[op.id] = !!op.audited_at;
    return m;
  });
  const auditedCount = useMemo(
    () => Object.values(auditedMap).filter(Boolean).length,
    [auditedMap],
  );

  const familyCount = useMemo(
    () => new Set(initialOperations.map((o) => o.family_key || o.name)).size,
    [initialOperations],
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
  const { distinctLabels, labelCounts } = useMemo(() => {
    const lc: Record<string, number> = {};
    for (const op of initialOperations) {
      const l = op.program_label || "Unlabeled";
      lc[l] = (lc[l] ?? 0) + 1;
    }
    return { distinctLabels: Object.keys(lc).sort(), labelCounts: lc };
  }, [initialOperations]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return initialOperations.filter((op) => {
      if (machineFilter !== "all" && op.machine !== machineFilter) return false;
      if (labelFilter !== "all" && (op.program_label || "Unlabeled") !== labelFilter) return false;
      const isAudited = auditedMap[op.id] ?? false;
      if (auditFilter === "pending" && isAudited) return false;
      if (auditFilter === "audited" && !isAudited) return false;
      if (tokens.length === 0) return true;
      return tokens.every((t) => op.search_text.includes(t));
    });
  }, [initialOperations, search, machineFilter, labelFilter, auditFilter, auditedMap]);

  // Group filtered rows into families (preserves name order).
  const families = useMemo(() => {
    const m = new Map<string, OperationListRow[]>();
    for (const op of filtered) {
      const k = op.family_key || op.name;
      const arr = m.get(k);
      if (arr) arr.push(op);
      else m.set(k, [op]);
    }
    return [...m.entries()].map(([key, variants]) => ({ key, variants }));
  }, [filtered]);

  const toggleAudit = async (id: string, next: boolean) => {
    setAuditedMap((m) => ({ ...m, [id]: next }));
    const res = await setOperationAudited(id, next);
    if (!res.ok) setAuditedMap((m) => ({ ...m, [id]: !next }));
  };
  const toggleExpand = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const open = async (id: string, mode: "edit" | "clone") => {
    setBusyId(id);
    try {
      const d = await getOperationDetail(id);
      if (!d) return;
      setShowCreate(false);
      if (mode === "edit") { setCloneSource(null); setEditSource(d); }
      else { setEditSource(null); setCloneSource(d); }
    } finally {
      setBusyId(null);
    }
  };
  const closeModal = () => { setShowCreate(false); setCloneSource(null); setEditSource(null); };
  const modalOpen = showCreate || !!cloneSource || !!editSource;

  function row(op: OperationListRow, indent: boolean) {
    const audited = auditedMap[op.id] ?? false;
    return (
      <TableRow
        key={op.id}
        className={cn("cursor-pointer", audited && "bg-green-50/40")}
        onClick={() => router.push(`/programs/${op.id}`)}
      >
        <TableCell className="w-8 text-center">
          {audited && <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Audited" />}
        </TableCell>
        <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">{op.code ?? "—"}</TableCell>
        <TableCell className={cn("font-medium", indent && "pl-6")}>
          {indent && op.material_label ? (
            <span className="text-[var(--muted-foreground)]">{op.material_label}</span>
          ) : (
            op.name
          )}
        </TableCell>
        <TableCell><span className={machineChip(op.machine)}>{OPERATION_MACHINE_LABELS[op.machine] ?? op.machine}</span></TableCell>
        <TableCell className="text-xs text-[var(--muted-foreground)]">{op.program_label ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1"><ArrowDownToLine className="h-3.5 w-3.5" />{op.input_count}</span>
        </TableCell>
        <TableCell className="text-right tabular-nums text-blue-700">
          <span className="inline-flex items-center gap-1"><ArrowUpFromLine className="h-3.5 w-3.5" />{op.output_count}</span>
        </TableCell>
        <TableCell className="w-[110px]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => toggleAudit(op.id, !audited)}
              title={audited ? "Audited — click to unmark" : "Mark audited"}
              className={cn(
                "p-1.5 rounded cursor-pointer",
                audited ? "text-green-600 hover:bg-green-50" : "text-[var(--muted-foreground)] hover:text-green-600 hover:bg-[var(--muted)]",
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => open(op.id, "edit")} disabled={busyId === op.id} title="Quick edit — fill items + quantities" className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50">
              {busyId === op.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => open(op.id, "clone")} disabled={busyId === op.id} title="Clone this program" className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cog className="h-6 w-6 text-[var(--muted-foreground)]" />
            Programs
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Standard Programs · {familyCount} programs
            {initialOperations.length !== familyCount && (
              <> ({initialOperations.length} incl. material variants)</>
            )}{" "}
            · <span className="text-green-700 font-medium">{auditedCount} audited</span> / {initialOperations.length - auditedCount} pending
          </p>
        </div>
        <Button onClick={() => { setCloneSource(null); setEditSource(null); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1.5" />Add Program
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by code or name..." className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1" />
        </div>
        <div className="flex items-center gap-1.5">
          <FilterChip label="All" count={initialOperations.length} active={machineFilter === "all"} onClick={() => setMachineFilter("all")} />
          {OPERATION_MACHINES.map((m) => (
            <FilterChip key={m} label={OPERATION_MACHINE_LABELS[m]} count={counts[m] ?? 0} active={machineFilter === m} onClick={() => setMachineFilter(m)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <FilterChip label="All Labels" count={initialOperations.length} active={labelFilter === "all"} onClick={() => setLabelFilter("all")} />
          {distinctLabels.map((l) => (
            <FilterChip key={l} label={l} count={labelCounts[l] ?? 0} active={labelFilter === l} onClick={() => setLabelFilter(labelFilter === l ? "all" : l)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <FilterChip label="Pending" count={initialOperations.length - auditedCount} active={auditFilter === "pending"} onClick={() => setAuditFilter(auditFilter === "pending" ? "all" : "pending")} />
          <FilterChip label="Audited" count={auditedCount} active={auditFilter === "audited"} onClick={() => setAuditFilter(auditFilter === "audited" ? "all" : "audited")} />
        </div>
      </div>

      <div className="border border-[var(--border)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center" title="Audited">✓</TableHead>
              <TableHead className="w-[190px]">Code</TableHead>
              <TableHead>Program Name</TableHead>
              <TableHead className="w-[120px]">Machine</TableHead>
              <TableHead className="w-[150px]">Label</TableHead>
              <TableHead className="w-[80px] text-right">In</TableHead>
              <TableHead className="w-[80px] text-right">Out</TableHead>
              <TableHead className="w-[110px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {families.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-12 text-[var(--muted-foreground)] text-sm">
                  {initialOperations.length === 0 ? "No programs yet." : "No programs match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              families.map(({ key, variants }) => {
                if (variants.length === 1) return row(variants[0], false);
                const isOpen = expanded.has(key);
                const auditedIn = variants.filter((v) => auditedMap[v.id]).length;
                return (
                  <Fragment key={key}>
                    <TableRow className="bg-[var(--muted)]/40 cursor-pointer" onClick={() => toggleExpand(key)}>
                      <TableCell className="w-10 text-center text-[var(--muted-foreground)]">
                        {isOpen ? <ChevronDown className="h-4 w-4 inline" /> : <ChevronRight className="h-4 w-4 inline" />}
                      </TableCell>
                      <TableCell colSpan={2} className="font-semibold">
                        {key}
                        <span className="ml-2 text-[11px] font-normal px-1.5 py-0.5 rounded-full bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)]">
                          {variants.length} variants
                        </span>
                      </TableCell>
                      <TableCell><span className={machineChip(variants[0].machine)}>{OPERATION_MACHINE_LABELS[variants[0].machine]}</span></TableCell>
                      <TableCell className="text-xs text-[var(--muted-foreground)]">{variants[0].program_label ?? "—"}</TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right text-[11px] text-[var(--muted-foreground)] tabular-nums">{auditedIn}/{variants.length}</TableCell>
                    </TableRow>
                    {isOpen && variants.map((v) => row(v, true))}
                  </Fragment>
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
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md text-sm border cursor-pointer transition-colors", active ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--accent-foreground)] font-medium" : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]")}>
      {label}
      <span className="text-[11px] opacity-70 tabular-nums">{count}</span>
    </button>
  );
}
