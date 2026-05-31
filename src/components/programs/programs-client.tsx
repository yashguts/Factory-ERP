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
  ChevronRight,
  ChevronDown,
  Layers,
  List,
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
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
type MatchFilter = "all" | "ready" | "unmatched";
type ViewMode = "family" | "flat";

const MACHINE_BADGE_VARIANT: Partial<Record<OperationMachine, BadgeVariant>> = {
  assembly_fit: "purple",
  cnc_laser: "cyan",
  cnc_punch: "blue",
  cnc_cutting: "blue",
  cnc_bending: "blue",
  powder_coat: "amber",
  manual_cut: "green",
  manual_weld: "green",
  manual_fit: "green",
};

/** Matched / total / unmatched line counts for one program. */
interface MatchInfo {
  total: number;
  matched: number;
  unmatched: number;
  fullyMatched: boolean;
  empty: boolean;
}

function matchInfo(op: OperationListRow): MatchInfo {
  const total = op.input_count + op.output_count;
  const matched = op.input_matched + op.output_matched;
  const unmatched = total - matched;
  return {
    total,
    matched,
    unmatched,
    fullyMatched: total > 0 && unmatched === 0,
    empty: total === 0,
  };
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
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [view, setView] = useState<ViewMode>("family");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [cloneSource, setCloneSource] = useState<OperationDetail | null>(null);
  const [editSource, setEditSource] = useState<OperationDetail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Confirm-before-audit: clicking the tick on a pending program opens this
  // dialog; the program is only marked audited if the user clicks Yes.
  const [confirmAudit, setConfirmAudit] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

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
  const { distinctLabels, labelCounts } = useMemo(() => {
    const lc: Record<string, number> = {};
    for (const op of initialOperations) {
      const l = op.program_label || "Unlabeled";
      lc[l] = (lc[l] ?? 0) + 1;
    }
    return { distinctLabels: Object.keys(lc).sort(), labelCounts: lc };
  }, [initialOperations]);

  // How many programs are fully matched vs still have unmapped lines —
  // drives the match filter chip counts.
  const matchCounts = useMemo(() => {
    let ready = 0;
    let unmatched = 0;
    for (const op of initialOperations) {
      const m = matchInfo(op);
      if (m.fullyMatched) ready++;
      if (m.unmatched > 0) unmatched++;
    }
    return { ready, unmatched };
  }, [initialOperations]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return initialOperations.filter((op) => {
      if (machineFilter !== "all" && op.machine !== machineFilter) return false;
      if (labelFilter !== "all" && (op.program_label || "Unlabeled") !== labelFilter) return false;
      const isAudited = auditedMap[op.id] ?? false;
      if (auditFilter === "pending" && isAudited) return false;
      if (auditFilter === "audited" && !isAudited) return false;
      if (matchFilter !== "all") {
        const m = matchInfo(op);
        if (matchFilter === "ready" && !m.fullyMatched) return false;
        if (matchFilter === "unmatched" && m.unmatched === 0) return false;
      }
      if (tokens.length === 0) return true;
      return tokens.every((t) => op.search_text.includes(t));
    });
  }, [
    initialOperations,
    search,
    machineFilter,
    labelFilter,
    auditFilter,
    matchFilter,
    auditedMap,
  ]);

  // Group filtered programs by family. Single-member families render as a
  // plain row; multi-member families collapse under an expandable header.
  const groups = useMemo(() => {
    const map = new Map<string, OperationListRow[]>();
    for (const op of filtered) {
      const key = op.family_key?.trim() || `__solo__${op.id}`;
      const arr = map.get(key) ?? [];
      arr.push(op);
      map.set(key, arr);
    }
    const entries = Array.from(map.entries()).map(([key, ops]) => {
      const sorted = [...ops].sort(
        (a, b) =>
          (a.material_label ?? "").localeCompare(b.material_label ?? "") ||
          a.name.localeCompare(b.name),
      );
      const label = sorted[0].family_key?.trim() || sorted[0].name;
      return { key, label, ops: sorted };
    });
    entries.sort((a, b) => a.label.localeCompare(b.label));
    return entries;
  }, [filtered]);

  // When the user is actively searching/filtering, expand every family so the
  // matching variants are visible without manual clicking.
  const forceExpandAll =
    search.trim().length > 0 || matchFilter !== "all" || auditFilter !== "all";
  const isExpanded = (key: string) => forceExpandAll || expanded.has(key);
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const multiGroupKeys = useMemo(
    () => groups.filter((g) => g.ops.length > 1).map((g) => g.key),
    [groups],
  );
  const allExpanded = multiGroupKeys.every((k) => expanded.has(k));
  const expandAll = () => setExpanded(new Set(multiGroupKeys));
  const collapseAll = () => setExpanded(new Set());

  const toggleAudit = async (id: string, next: boolean) => {
    setAuditedMap((m) => ({ ...m, [id]: next }));
    const res = await setOperationAudited(id, next);
    if (!res.ok) setAuditedMap((m) => ({ ...m, [id]: !next }));
  };

  // Clicking the tick: unmark immediately, but require confirmation before
  // marking a program audited (it asserts every line was reviewed).
  const requestAudit = (op: { id: string; name: string }) => {
    const audited = auditedMap[op.id] ?? false;
    if (audited) toggleAudit(op.id, false);
    else setConfirmAudit({ id: op.id, name: op.name });
  };

  const confirmAuditYes = async () => {
    if (!confirmAudit) return;
    setAuditBusy(true);
    await toggleAudit(confirmAudit.id, true);
    setAuditBusy(false);
    setConfirmAudit(null);
  };

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

  /** Colored "matched/total" cell for inputs or outputs. */
  function CountCell({
    matched,
    total,
    icon,
  }: {
    matched: number;
    total: number;
    icon: React.ReactNode;
  }) {
    const tone =
      total === 0
        ? "text-[var(--muted-foreground)]"
        : matched === total
          ? "text-emerald-600"
          : "text-amber-600";
    return (
      <span className={cn("inline-flex items-center gap-1 tabular-nums", tone)}>
        {icon}
        {matched}/{total}
      </span>
    );
  }

  function MatchBadge({ info }: { info: MatchInfo }) {
    if (info.empty) return <Badge variant="neutral">No items</Badge>;
    if (info.fullyMatched) return <Badge variant="success">Ready</Badge>;
    return <Badge variant="warning">{info.unmatched} to map</Badge>;
  }

  /** A normal (non-nested) program row — used in flat view and for singletons. */
  function programRow(op: OperationListRow, opts?: { nested?: boolean }) {
    const audited = auditedMap[op.id] ?? false;
    const info = matchInfo(op);
    const nested = opts?.nested ?? false;
    return (
      <TableRow
        key={op.id}
        className={cn(
          "cursor-pointer",
          audited && "bg-[var(--success-bg)]/40",
          nested && "bg-[var(--muted)]/20",
        )}
        onClick={() => router.push(`/programs/${op.id}`)}
      >
        <TableCell className="w-10 text-center">
          {audited && (
            <span
              className="inline-block h-2 w-2 rounded-full bg-emerald-500"
              title="Audited"
            />
          )}
        </TableCell>
        <TableCell
          className={cn(
            "font-mono text-xs text-[var(--muted-foreground)]",
            nested && "pl-6",
          )}
        >
          {op.code ?? "—"}
        </TableCell>
        <TableCell>
          {nested ? (
            <span className="inline-flex items-center gap-2">
              <Badge variant="neutral">{op.material_label ?? "—"}</Badge>
            </span>
          ) : (
            <span className="font-medium">{op.name}</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={MACHINE_BADGE_VARIANT[op.machine] ?? "neutral"}>
            {OPERATION_MACHINE_LABELS[op.machine] ?? op.machine}
          </Badge>
        </TableCell>
        <TableCell>
          <MatchBadge info={info} />
        </TableCell>
        <TableCell className="text-right">
          <CountCell
            matched={op.input_matched}
            total={op.input_count}
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
          />
        </TableCell>
        <TableCell className="text-right">
          <CountCell
            matched={op.output_matched}
            total={op.output_count}
            icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
          />
        </TableCell>
        <TableCell className="w-[116px]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => requestAudit(op)}
              title={audited ? "Audited — click to unmark" : "Mark audited"}
              className={cn(
                "p-1.5 rounded cursor-pointer",
                audited
                  ? "text-emerald-600 hover:bg-emerald-50"
                  : "text-[var(--muted-foreground)] hover:text-emerald-600 hover:bg-[var(--muted)]",
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => open(op.id, "edit")}
              disabled={busyId === op.id}
              title="Quick edit — fill items + quantities"
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50"
            >
              {busyId === op.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => open(op.id, "clone")}
              disabled={busyId === op.id}
              title="Clone this program"
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  /** An expandable family header row aggregating its material variants. */
  function familyHeaderRow(group: { key: string; label: string; ops: OperationListRow[] }) {
    const { key, label, ops } = group;
    const open = isExpanded(key);
    const machines = Array.from(new Set(ops.map((o) => o.machine)));
    const auditedInFamily = ops.filter((o) => auditedMap[o.id]).length;
    const familyUnmatched = ops.reduce((s, o) => s + matchInfo(o).unmatched, 0);
    const materials = ops
      .map((o) => o.material_label)
      .filter((m): m is string => !!m);
    const previewMaterials = materials.slice(0, 4);
    const extraMaterials = materials.length - previewMaterials.length;

    return (
      <TableRow
        key={key}
        className="cursor-pointer bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70"
        onClick={() => toggleExpand(key)}
      >
        <TableCell className="w-10 text-center text-[var(--muted-foreground)]">
          {open ? (
            <ChevronDown className="h-4 w-4 inline" />
          ) : (
            <ChevronRight className="h-4 w-4 inline" />
          )}
        </TableCell>
        <TableCell>
          <Badge variant="blue">
            <Layers className="h-3 w-3 mr-1" />
            {ops.length} variants
          </Badge>
        </TableCell>
        <TableCell>
          <span className="font-semibold">{label}</span>
          {previewMaterials.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {previewMaterials.map((m) => (
                <span
                  key={m}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)]"
                >
                  {m}
                </span>
              ))}
              {extraMaterials > 0 && (
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  +{extraMaterials} more
                </span>
              )}
            </span>
          )}
        </TableCell>
        <TableCell>
          {machines.length === 1 ? (
            <Badge variant={MACHINE_BADGE_VARIANT[machines[0]] ?? "neutral"}>
              {OPERATION_MACHINE_LABELS[machines[0]] ?? machines[0]}
            </Badge>
          ) : (
            <span className="text-xs text-[var(--muted-foreground)]">Mixed</span>
          )}
        </TableCell>
        <TableCell>
          {familyUnmatched === 0 ? (
            <Badge variant="success">All ready</Badge>
          ) : (
            <Badge variant="warning">{familyUnmatched} to map</Badge>
          )}
        </TableCell>
        <TableCell
          className="text-right text-xs text-[var(--muted-foreground)]"
          colSpan={2}
        >
          {auditedInFamily}/{ops.length} audited
        </TableCell>
        <TableCell className="w-[116px]" />
      </TableRow>
    );
  }

  const showGroupChrome = view === "family";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cog className="h-6 w-6 text-[var(--muted-foreground)]" />
            Programs
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {initialOperations.length} programs
            {" · "}
            <span className="text-emerald-700 font-medium">
              {auditedCount} audited
            </span>{" "}
            / {initialOperations.length - auditedCount} pending
            {" · "}
            <span className="text-amber-700 font-medium">
              {matchCounts.unmatched} need item mapping
            </span>
          </p>
        </div>
        <Button onClick={() => { setCloneSource(null); setEditSource(null); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1.5" />Add Program
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by code, name, material or item..." className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] focus:ring-offset-1 transition-colors" />
        </div>

        {/* View toggle: group material variants by family, or flat list. */}
        <div className="inline-flex items-center rounded-md border border-[var(--border)] p-0.5">
          <button
            type="button"
            onClick={() => setView("family")}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 h-8 rounded text-sm cursor-pointer transition-colors",
              view === "family"
                ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
            title="Group material variants under their base program"
          >
            <Layers className="h-3.5 w-3.5" />
            Grouped
          </button>
          <button
            type="button"
            onClick={() => setView("flat")}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 h-8 rounded text-sm cursor-pointer transition-colors",
              view === "flat"
                ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
            title="Show every program as its own row"
          >
            <List className="h-3.5 w-3.5" />
            Flat
          </button>
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
          <FilterChip label="Ready" tone="green" count={matchCounts.ready} active={matchFilter === "ready"} onClick={() => setMatchFilter(matchFilter === "ready" ? "all" : "ready")} />
          <FilterChip label="Needs mapping" tone="amber" count={matchCounts.unmatched} active={matchFilter === "unmatched"} onClick={() => setMatchFilter(matchFilter === "unmatched" ? "all" : "unmatched")} />
          <FilterChip label="Pending" count={initialOperations.length - auditedCount} active={auditFilter === "pending"} onClick={() => setAuditFilter(auditFilter === "pending" ? "all" : "pending")} />
          <FilterChip label="Audited" tone="green" count={auditedCount} active={auditFilter === "audited"} onClick={() => setAuditFilter(auditFilter === "audited" ? "all" : "audited")} />
        </div>
      </div>

      {showGroupChrome && multiGroupKeys.length > 0 && !forceExpandAll && (
        <div className="mb-2 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <span>{groups.length} families</span>
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline cursor-pointer"
          >
            {allExpanded ? (
              <>
                <ChevronRight className="h-3 w-3" /> Collapse all
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Expand all
              </>
            )}
          </button>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center" title="Audited">✓</TableHead>
              <TableHead className="w-[180px]">{showGroupChrome ? "Code / Variants" : "Code"}</TableHead>
              <TableHead>{showGroupChrome ? "Program / Family" : "Program Name"}</TableHead>
              <TableHead className="w-[120px]">Machine</TableHead>
              <TableHead className="w-[130px]">Match</TableHead>
              <TableHead className="w-[72px] text-right" title="Inputs matched / total">In</TableHead>
              <TableHead className="w-[72px] text-right" title="Outputs matched / total">Out</TableHead>
              <TableHead className="w-[116px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-12 text-[var(--muted-foreground)] text-sm">
                  {initialOperations.length === 0 ? "No programs yet." : "No programs match your filters."}
                </TableCell>
              </TableRow>
            ) : view === "flat" ? (
              filtered.map((op) => programRow(op))
            ) : (
              groups.flatMap((group) => {
                if (group.ops.length === 1) return [programRow(group.ops[0])];
                const rows = [familyHeaderRow(group)];
                if (isExpanded(group.key)) {
                  for (const op of group.ops) rows.push(programRow(op, { nested: true }));
                }
                return rows;
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

      {confirmAudit && (
        <ConfirmDialog
          title="Mark program audited?"
          message={
            <>
              Are you sure all inputs and outputs in{" "}
              <span className="font-medium">{confirmAudit.name}</span> are
              accurate and correctly mapped to inventory? Marking it audited
              records that this program has been reviewed.
            </>
          }
          confirmLabel="Yes, mark audited"
          cancelLabel="No"
          busy={auditBusy}
          onConfirm={confirmAuditYes}
          onCancel={() => setConfirmAudit(null)}
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
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "green" | "amber";
}) {
  const activeClass =
    tone === "green"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700 font-medium"
      : tone === "amber"
        ? "border-amber-300 bg-amber-50 text-amber-700 font-medium"
        : "border-[var(--primary)] bg-[var(--accent)] text-[var(--accent-foreground)] font-medium";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md text-sm border cursor-pointer transition-colors",
        active
          ? activeClass
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
      )}
    >
      {label}
      <span className="text-[11px] opacity-70 tabular-nums">{count}</span>
    </button>
  );
}
