"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, ArrowUpDown, Pencil, Columns2, PanelRightClose, Trash2, Loader2, Truck, Package, AlertTriangle, CheckCircle2, FileClock, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { updateJob, deleteJob, setJobBomAudited } from "@/lib/actions/jobs";
import { BOM_SECTIONS, PHASE_ORDER, dispatchPhaseOf } from "@/lib/bom/bom-sections";
import { shouldRenderSection, driveTypeLabel } from "@/lib/bom/section-gating";
import { GadDrawingPanel } from "@/components/jobs/gad-drawing-panel";
import { DispatchPanel } from "@/components/jobs/dispatch-panel";
import { DispatchModal } from "@/components/jobs/dispatch-modal";
import type { JobDispatchSummary } from "@/lib/actions/dispatch";
import { dispatchStat, toneChip } from "@/lib/dispatch-status";
import type { Job, JobStatus, JobStage, JobGadVersion } from "@/lib/supabase/types";
import { gadAlert, acknowledgedRev } from "@/lib/jobs/gad-alert";
import { useOperator } from "@/lib/jobs/use-operator";

const STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  in_production: "In Production",
  hold: "Hold",
};

const STATUS_BADGE: Record<JobStatus, BadgeVariant> = {
  new: "neutral",
  in_production: "amber",
  hold: "red",
};

// "Full material" is the 2nd (final) dispatch phase — see Jobs list note.
const STAGE_LABELS: Record<JobStage, string> = {
  new: "New",
  first_phase: "1st phase",
  full_material: "2nd phase",
};

interface BomLineWithItem {
  id: string;
  item_id: string | null;
  required_quantity: number;
  issued_quantity: number;
  wastage_percent: number;
  sort_order: number;
  source_col_index: number | null;
  category: string | null;
  variant: string | null;
  value_text: string | null;
  item: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    category_id: string | null;
    uom_id: string;
    category: { name: string } | null;
    uom: { abbreviation: string } | null;
  } | null;
}

interface BomSectionLine {
  category: string;
  variant: string;
  value_text: string | null;
  required_quantity: number;
}

interface Props {
  job: Job;
  bomLines: BomLineWithItem[];
  bomHeaderId: string | null;
  bomSectionLines: BomSectionLine[];
  dispatch: JobDispatchSummary;
  /** On-hand stock per item id, scoped to this job's BOM. */
  stockByItem: Record<string, number>;
  /** GAD upload history, newest revision first. */
  gadVersions: JobGadVersion[];
}

type SortKey = "code" | "name" | "category" | "required" | "dispatched";
type SortDir = "asc" | "desc";
type ViewTab = "sections" | "items";

export function JobDetailClient({ job, bomLines, bomHeaderId, bomSectionLines, dispatch, stockByItem, gadVersions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [auditing, startAudit] = useTransition();
  const { ensureOperator } = useOperator();
  const [showDispatch, setShowDispatch] = useState(false);
  const [bomSearch, setBomSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const hasItemBom = bomLines.some((l) => l.item_id != null);
  const hasSectionBom = bomSectionLines.length > 0 || bomLines.some((l) => l.category != null);
  const [viewTab, setViewTab] = useState<ViewTab>("sections");

  // Live dispatch progress from recorded dispatches, keyed for the BOM views:
  // per BOM line (id -> dispatched qty) and per section (category -> status).
  // Same numbers the Dispatch panel shows — presentation only.
  const dispByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of dispatch.lines) m.set(l.job_bom_line_id, l.dispatched);
    return m;
  }, [dispatch]);
  const sectionStat = useMemo(() => {
    const byCat = new Map<string, { remaining: number }[]>();
    for (const l of dispatch.lines) {
      const arr = byCat.get(l.category) ?? [];
      arr.push({ remaining: l.remaining });
      byCat.set(l.category, arr);
    }
    const m = new Map<string, ReturnType<typeof dispatchStat>>();
    for (const [cat, lines] of byCat.entries()) m.set(cat, dispatchStat(lines));
    return m;
  }, [dispatch]);

  // Split-screen with the GAD drawing on the right. Auto-on if a
  // drawing is already attached so the user sees it immediately.
  const [splitView, setSplitView] = useState<boolean>(!!job.gad_drawing_url);

  const handleStatusChange = (newStatus: JobStatus) => {
    startTransition(async () => {
      await updateJob(job.id, { status: newStatus });
      router.refresh();
    });
  };

  // "Mark Audited (with changes)" — acknowledge the current GAD revision so the
  // drift alert clears across every surface. Records who audited (operator).
  const handleMarkAudited = () => {
    const operator = ensureOperator();
    startAudit(async () => {
      const res = await setJobBomAudited(job.id, true, operator);
      if (!res.ok) {
        alert(`Could not mark audited: ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const handleDelete = () => {
    // Two-step destructive guard: must type the exact job number.
    const typed = window.prompt(
      `Permanently delete job "${job.job_number}"?\n\n` +
        "This removes the job, all its BOM lines and the GAD drawing. " +
        "The action cannot be undone.\n\n" +
        `Type "${job.job_number}" to confirm:`,
    );
    if (typed === null) return; // cancelled
    if (typed.trim() !== job.job_number) {
      alert(
        "Job number did not match. Delete cancelled.",
      );
      return;
    }
    startTransition(async () => {
      const result = await deleteJob(job.id);
      if (!result.ok) {
        alert(`Could not delete job: ${result.error}`);
        return;
      }
      router.push("/jobs");
    });
  };

  // Section-based BOM: group all bom lines (item-based + legacy variant) by category → phase
  const sectionData = useMemo(() => {
    // Build a map of category → display lines from ALL sources
    const catLines = new Map<string, Array<{ label: string; value: string }>>();

    // 1) Item-based BOM lines (new picker format + Excel imports)
    for (const line of bomLines) {
      if (!line.item_id || !line.item) continue;
      const cat = line.category ?? "Uncategorized";
      const arr = catLines.get(cat) ?? [];
      arr.push({
        label: `${line.item.code} — ${line.item.name}`,
        value: `${Number(line.required_quantity).toLocaleString()} ${line.item.uom?.abbreviation ?? ""}`.trim(),
      });
      catLines.set(cat, arr);
    }

    // 2) Legacy variant-based lines (no item_id)
    for (const l of bomSectionLines) {
      if (!l.category) continue;
      // skip if this category already has item-based lines (avoid mixing)
      if (catLines.has(l.category)) continue;
      const arr = catLines.get(l.category) ?? [];
      const display = l.value_text
        ? l.value_text
        : l.required_quantity
          ? Number(l.required_quantity).toLocaleString()
          : "";
      if (!display) continue;
      arr.push({ label: l.variant, value: display });
      catLines.set(l.category, arr);
    }

    // Group by phase using BOM_SECTIONS ordering
    const phases: Array<{
      phase: string;
      sections: Array<{
        category: string;
        lines: Array<{ label: string; value: string }>;
      }>;
    }> = [];

    for (const phase of PHASE_ORDER) {
      const sections = BOM_SECTIONS.filter(
        (s) =>
          s.phase === phase &&
          shouldRenderSection(s, job.door_type, job.drive_type) &&
          catLines.has(s.category) &&
          (catLines.get(s.category)?.length ?? 0) > 0,
      );

      if (sections.length > 0) {
        phases.push({
          phase,
          sections: sections.map((s) => ({
            category: s.category,
            lines: catLines.get(s.category) ?? [],
          })),
        });
      }
    }

    // Also include categories not in BOM_SECTIONS (e.g. custom categories)
    const knownCats = new Set(BOM_SECTIONS.map((s) => s.category));
    const extraCats = Array.from(catLines.entries()).filter(
      ([cat, lines]) => !knownCats.has(cat) && lines.length > 0,
    );
    if (extraCats.length > 0) {
      phases.push({
        phase: "Other",
        sections: extraCats.map(([cat, lines]) => ({ category: cat, lines })),
      });
    }

    return phases;
  }, [bomLines, bomSectionLines, job.door_type, job.drive_type]);

  // Item-based BOM filtering/sorting
  const itemBomLines = useMemo(
    () => bomLines.filter((l) => l.item_id != null),
    [bomLines],
  );

  // Real "shipped %" from recorded dispatches. job.progress is a dead legacy
  // field (~0 on every job), so we compute completion from the dispatch
  // summary instead: Σ dispatched (capped per line so over-dispatch can't
  // exceed 100%) / Σ required across the item BOM.
  const shipped = useMemo(() => {
    let req = 0;
    let disp = 0;
    for (const l of itemBomLines) {
      const r = Number(l.required_quantity) || 0;
      req += r;
      disp += Math.min(dispByLine.get(l.id) ?? 0, r);
    }
    return { req, disp, pct: req > 0 ? Math.round((disp / req) * 100) : 0 };
  }, [itemBomLines, dispByLine]);

  // Stock readiness per dispatch phase: of the material still to ship
  // (required − dispatched), how much is NOT coverable from current on-hand
  // stock. Stock is a global balance, not reserved per job, so this is "in
  // stock now", optimistic when jobs compete for the same item.
  const readiness = useMemo(() => {
    const phases = {
      first: { lines: 0, short: 0, shortUnits: 0 },
      second: { lines: 0, short: 0, shortUnits: 0 },
    };
    for (const l of itemBomLines) {
      const remaining = Math.max(0, Number(l.required_quantity) - (dispByLine.get(l.id) ?? 0));
      if (remaining <= 0) continue;
      const have = stockByItem[l.item_id ?? ""] ?? 0;
      const short = Math.max(0, remaining - have);
      const ph = dispatchPhaseOf(l.category ?? "") === "first" ? "first" : "second";
      phases[ph].lines += 1;
      if (short > 0) {
        phases[ph].short += 1;
        phases[ph].shortUnits += short;
      }
    }
    return phases;
  }, [itemBomLines, dispByLine, stockByItem]);

  const filteredBom = useMemo(() => {
    // Multi-token fuzzy match across code / name / category.
    const tokens = bomSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return itemBomLines;
    return itemBomLines.filter((line) => {
      const item = line.item;
      if (!item) return false;
      const haystack = [item.code, item.name, item.category?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      for (const t of tokens) {
        if (!haystack.includes(t)) return false;
      }
      return true;
    });
  }, [itemBomLines, bomSearch]);

  const sortedBom = useMemo(() => {
    const copy = [...filteredBom];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code":
          cmp = (a.item?.code ?? "").localeCompare(b.item?.code ?? "");
          break;
        case "name":
          cmp = (a.item?.name ?? "").localeCompare(b.item?.name ?? "");
          break;
        case "category":
          cmp = (a.item?.category?.name ?? "").localeCompare(b.item?.category?.name ?? "");
          break;
        case "required":
          cmp = a.required_quantity - b.required_quantity;
          break;
        case "dispatched":
          cmp = (dispByLine.get(a.id) ?? 0) - (dispByLine.get(b.id) ?? 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredBom, sortKey, sortDir, dispByLine]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortHeader = ({ label, sortField }: { label: string; sortField: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-[var(--muted)] transition-colors"
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={sortKey === sortField ? "text-[var(--primary)]" : "opacity-30"} />
      </span>
    </TableHead>
  );

  const MetaItem = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div>
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-sm font-medium">{value || "-"}</dd>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        onBack={() =>
          window.history.length > 1 ? router.back() : router.push("/jobs")
        }
        title={
          <span className="flex items-center gap-2">
            Job {job.job_number}
            <Badge variant={STATUS_BADGE[job.status]}>
              {STATUS_LABELS[job.status]}
            </Badge>
          </span>
        }
        subtitle={`${job.customer_name || "No customer"}${job.brand ? ` — ${job.brand}` : ""}`}
        actions={
          <>
            <Button
              size="sm"
              onClick={() => setShowDispatch(true)}
              title="Record a dispatch for this job"
            >
              <Truck className="h-4 w-4 mr-1" />
              Dispatch
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/jobs/${job.id}/packing-list`)}
              title="Open the comprehensive packing list for this job"
            >
              <Package className="h-4 w-4 mr-1" />
              Packing List
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSplitView((v) => !v)}
              title={splitView ? "Hide drawing pane" : "Show drawing pane (split view)"}
            >
              {splitView ? (
                <PanelRightClose className="h-4 w-4 mr-1" />
              ) : (
                <Columns2 className="h-4 w-4 mr-1" />
              )}
              {splitView ? "Hide Drawing" : "Drawing"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/jobs/${job.id}/edit`)}
            >
              <Pencil className="h-4 w-4 mr-1" />
              Edit BOM
            </Button>
            <Select
              value={job.status}
              onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
              size="sm"
              className="w-[150px]"
              disabled={isPending}
            >
              {(Object.keys(STATUS_LABELS) as JobStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
              aria-label="Delete job"
              title="Delete this job permanently"
              className="text-[var(--destructive)] hover:bg-[var(--destructive-bg)]"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </>
        }
      />

      {/* GAD-changed-after-BOM alert — the drawing moved past what the BOM was
          reconciled against. Review the new drawing, then Mark Audited. */}
      {gadAlert(job) && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <div className="flex-1 text-sm text-red-800">
              <div className="font-semibold">GAD changed after the BOM was defined</div>
              <div className="mt-0.5 text-red-700">
                The drawing is now <strong>rev {job.gad_revision_no}</strong>, but the BOM was last
                reconciled at <strong>rev {acknowledgedRev(job) ?? 0}</strong>. Review the new drawing
                against the BOM (and any cut programs / procurement / dispatch), then mark it audited.
              </div>
            </div>
            <Button size="sm" onClick={handleMarkAudited} disabled={auditing} className="shrink-0">
              {auditing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Mark Audited
            </Button>
          </div>
        </div>
      )}

      {/* GAD version history — every uploaded drawing is kept. Auto-open when the
          alert is active so the reviewer can compare the current vs. baseline. */}
      {gadVersions.length > 0 && (
        <details open={gadAlert(job)} className="mb-4 card-surface overflow-hidden p-0">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm font-medium">
            <FileClock size={15} className="text-[var(--muted-foreground)]" />
            GAD version history
            <span className="text-xs text-[var(--muted-foreground)]">({gadVersions.length})</span>
          </summary>
          <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {gadVersions.map((v) => {
              const ack = acknowledgedRev(job);
              return (
                <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="shrink-0 font-mono font-semibold">rev {v.revision_no}</span>
                  {v.is_current && <Badge variant="green">Current</Badge>}
                  {ack === v.revision_no && <Badge variant="blue">BOM based on this</Badge>}
                  <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]" title={v.filename}>
                    {v.filename}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {new Date(v.uploaded_at).toLocaleDateString("en-IN")}
                    {v.uploaded_by && v.uploaded_by !== "unknown" ? ` · ${v.uploaded_by}` : ""}
                  </span>
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-[var(--primary)] hover:underline"
                  >
                    <ExternalLink size={13} /> View
                  </a>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Split layout: when on, the detail body scrolls on the left and
          the GAD drawing on the right (each independently). */}
      <div
        className={
          splitView
            ? "grid grid-cols-2 gap-3 h-[calc(100vh-200px)] min-h-0"
            : "contents"
        }
      >
        <div className={splitView ? "overflow-y-auto pr-2" : "contents"}>

      {/* Dispatched progress — real shipped % from recorded dispatches */}
      {hasItemBom && (
        <div className="mb-4 p-3 card-surface">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Dispatched</span>
            <span className="text-sm text-[var(--muted-foreground)]">
              {shipped.pct}%
              <span className="mx-1.5 text-[var(--border-strong)]">·</span>
              {shipped.disp.toLocaleString()} of {shipped.req.toLocaleString()} units
            </span>
          </div>
          <div className="w-full h-2.5 bg-[var(--muted)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${shipped.pct}%`,
                backgroundColor: shipped.pct >= 100 ? "var(--success)" : "var(--primary)",
              }}
            />
          </div>
        </div>
      )}

      {/* Stock readiness — can the remaining material ship from current stock? */}
      {hasItemBom && (readiness.first.lines > 0 || readiness.second.lines > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--muted-foreground)]">Stock readiness:</span>
          {(["first", "second"] as const).map((ph) => {
            const r = readiness[ph];
            if (r.lines === 0) return null;
            const label = ph === "first" ? "1st phase" : "2nd phase";
            return r.short === 0 ? (
              <Badge key={ph} variant="green">{label}: ready ({r.lines})</Badge>
            ) : (
              <Badge key={ph} variant="amber">
                {label}: {r.short} short · {r.shortUnits.toLocaleString()} units
              </Badge>
            );
          })}
          <span className="text-[11px] text-[var(--muted-foreground)]">in stock now, not reserved</span>
        </div>
      )}

      {/* Metadata Grid — core fields always; legacy columns only when set,
          so existing-job data is still shown but blank columns don't clutter. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 p-3 card-surface">
        <MetaItem label="Spec" value={job.spec_string} />
        <MetaItem label="Stops" value={job.floors?.toString()} />
        <MetaItem label="Drive Type" value={driveTypeLabel(job.drive_type)} />
        <MetaItem label="Capacity" value={job.capacity} />
        <MetaItem label="Structure" value={job.structure_included} />
        <MetaItem label="Location" value={job.location} />
        <MetaItem label="Mobile" value={job.mobile_number} />
        <MetaItem label="Sent" value={STAGE_LABELS[job.stage ?? "new"]} />
        <MetaItem
          label="Required"
          value={job.requirement_stage ? STAGE_LABELS[job.requirement_stage] : null}
        />
        <MetaItem
          label="Req. Dispatch"
          value={job.requirement_dispatch_date ? new Date(job.requirement_dispatch_date).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Created"
          value={`${new Date(job.created_at).toLocaleDateString("en-IN")}${
            job.created_by && job.created_by !== "unknown" ? ` · ${job.created_by}` : ""
          }`}
        />
        {job.door_type && <MetaItem label="Door Type" value={job.door_type} />}
        {job.door_finish && <MetaItem label="Door Finish" value={job.door_finish} />}
        {job.brand && <MetaItem label="Brand" value={job.brand} />}
        {job.order_date && (
          <MetaItem label="Order Date" value={new Date(job.order_date).toLocaleDateString("en-IN")} />
        )}
        {job.expected_delivery && (
          <MetaItem label="Expected Delivery" value={new Date(job.expected_delivery).toLocaleDateString("en-IN")} />
        )}
        {job.planned_start && (
          <MetaItem label="Planned Start" value={new Date(job.planned_start).toLocaleDateString("en-IN")} />
        )}
        {job.planned_end && (
          <MetaItem label="Planned End" value={new Date(job.planned_end).toLocaleDateString("en-IN")} />
        )}
      </div>

      {job.remark && (
        <div className="mb-4 p-3 card-surface">
          <h3 className="text-sm font-medium mb-1">Remark</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{job.remark}</p>
        </div>
      )}

      {/* Dispatch */}
      <DispatchPanel
        jobId={job.id}
        summary={dispatch}
        onNewDispatch={() => setShowDispatch(true)}
      />
      {showDispatch && (
        <DispatchModal
          jobId={job.id}
          jobNumber={job.job_number}
          onClose={() => setShowDispatch(false)}
          onSaved={() => router.refresh()}
        />
      )}

      {/* BOM Section */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">Bill of Materials</h2>
            {(hasSectionBom && hasItemBom) && (
              <Tabs
                variant="segmented"
                value={viewTab}
                onChange={(v) => setViewTab(v as ViewTab)}
                tabs={[
                  { value: "sections", label: "By Section", count: bomSectionLines.length },
                  { value: "items", label: "By Item", count: itemBomLines.length },
                ]}
              />
            )}
          </div>
          {viewTab === "items" && hasItemBom && (
            <div className="relative w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
              <Input
                size="sm"
                placeholder="Search BOM items..."
                value={bomSearch}
                onChange={(e) => setBomSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
        </div>

        {/* Section View */}
        {viewTab === "sections" && (
          hasSectionBom ? (
            <div className="space-y-4">
              {sectionData.map((phase) => (
                <div key={phase.phase}>
                  <h3 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
                    {phase.phase}
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {phase.sections.map((sec) => (
                      <div
                        key={sec.category}
                        className="card-surface p-3"
                      >
                        <h4 className="font-medium text-sm mb-2 flex items-center gap-2 flex-wrap">
                          {sec.category}
                          <Badge
                            variant={dispatchPhaseOf(sec.category) === "first" ? "blue" : "neutral"}
                            title="Dispatch phase"
                          >
                            {dispatchPhaseOf(sec.category) === "first" ? "1st phase" : "2nd phase"}
                          </Badge>
                          {(() => {
                            const st = sectionStat.get(sec.category);
                            return st ? (
                              <span
                                className={`text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 border ${toneChip(st.tone)}`}
                                title="Dispatch progress"
                              >
                                {st.label}
                              </span>
                            ) : null;
                          })()}
                        </h4>
                        <div className="grid grid-cols-1 gap-y-1">
                          {sec.lines.map((line, li) => (
                            <div key={li} className="flex justify-between text-sm py-0.5">
                              <span className="text-[var(--muted-foreground)] truncate mr-2">
                                {line.label}
                              </span>
                              <span className="font-medium whitespace-nowrap">
                                {line.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-surface">
              <EmptyState
                icon={<Pencil size={26} />}
                title="No section-based BOM data yet"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push(`/jobs/${job.id}/edit`)}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Add BOM Data
                  </Button>
                }
              />
            </div>
          )
        )}

        {/* Item View */}
        {viewTab === "items" && (
          hasItemBom ? (
            <div className="card-surface overflow-hidden">
              <Table density="compact">
                <TableHeader sticky>
                  <TableRow>
                    <SortHeader label="Code" sortField="code" />
                    <SortHeader label="Item" sortField="name" />
                    <SortHeader label="Category" sortField="category" />
                    <SortHeader label="Required" sortField="required" />
                    <SortHeader label="Dispatched" sortField="dispatched" />
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">In stock</TableHead>
                    <TableHead className="text-right">Short</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedBom.map((line) => {
                    const dispatched = dispByLine.get(line.id) ?? 0;
                    const remaining = line.required_quantity - dispatched;
                    const stock = stockByItem[line.item_id ?? ""] ?? 0;
                    const short = Math.max(0, remaining - stock);
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">{line.item?.code ?? "-"}</TableCell>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            {line.item?.name ?? "-"}
                            {dispatchPhaseOf(line.category ?? "") === "first" && (
                              <Badge variant="blue" title="First-phase dispatch item">
                                1st phase
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>{line.item?.category?.name ?? "-"}</TableCell>
                        <TableCell className="text-right font-medium">
                          {Number(line.required_quantity).toLocaleString()}{" "}
                          <span className="text-xs text-[var(--muted-foreground)]">{line.item?.uom?.abbreviation}</span>
                        </TableCell>
                        <TableCell className="text-right">{dispatched.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={remaining > 0 ? "text-[var(--warning)]" : "text-[var(--success)]"}>
                            {remaining > 0 ? remaining.toLocaleString() : "Done"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-[var(--muted-foreground)]">
                          {stock.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {short > 0 ? (
                            <span className="text-[var(--destructive)]">{short.toLocaleString()}</span>
                          ) : (
                            <span className="text-[var(--success)]">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="card-surface">
              <EmptyState
                title="No item-based BOM data"
                description="Import from Excel to populate."
              />
            </div>
          )
        )}
      </div>

        </div>

        {splitView && (
          <div className="h-[calc(100vh-200px)]">
            <GadDrawingPanel
              jobId={job.id}
              initialUrl={job.gad_drawing_url}
              initialFilename={job.gad_drawing_filename}
              initialUploadedAt={job.gad_drawing_uploaded_at}
              onClose={() => setSplitView(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
