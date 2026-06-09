"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { ArrowLeft, Search, ArrowUpDown, Pencil, Columns2, PanelRightClose, Trash2, Loader2, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { updateJob, deleteJob } from "@/lib/actions/jobs";
import { BOM_SECTIONS, PHASE_ORDER, dispatchPhaseOf } from "@/lib/bom/bom-sections";
import { shouldRenderSection } from "@/lib/bom/section-gating";
import { GadDrawingPanel } from "@/components/jobs/gad-drawing-panel";
import { DispatchPanel } from "@/components/jobs/dispatch-panel";
import { DispatchModal } from "@/components/jobs/dispatch-modal";
import type { JobDispatchSummary } from "@/lib/actions/dispatch";
import type { Job, JobStatus, JobStage } from "@/lib/supabase/types";

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

const STAGE_LABELS: Record<JobStage, string> = {
  new: "New",
  first_phase: "First Phase",
  full_material: "Full Material",
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
}

type SortKey = "code" | "name" | "category" | "required" | "issued";
type SortDir = "asc" | "desc";
type ViewTab = "sections" | "items";

export function JobDetailClient({ job, bomLines, bomHeaderId, bomSectionLines, dispatch }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDispatch, setShowDispatch] = useState(false);
  const [bomSearch, setBomSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const hasItemBom = bomLines.some((l) => l.item_id != null);
  const hasSectionBom = bomSectionLines.length > 0 || bomLines.some((l) => l.category != null);
  const [viewTab, setViewTab] = useState<ViewTab>("sections");

  // Split-screen with the GAD drawing on the right. Auto-on if a
  // drawing is already attached so the user sees it immediately.
  const [splitView, setSplitView] = useState<boolean>(!!job.gad_drawing_url);

  const pct = Math.round((job.progress ?? 0) * 100);

  const handleStatusChange = (newStatus: JobStatus) => {
    startTransition(async () => {
      await updateJob(job.id, { status: newStatus });
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
        case "issued":
          cmp = a.issued_quantity - b.issued_quantity;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredBom, sortKey, sortDir]);

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
      {/* Back + Header */}
      <div className="mb-6">
        <button
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push("/jobs")
          }
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3 cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to Jobs
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Job {job.job_number}</h1>
              <Badge variant={STATUS_BADGE[job.status]}>
                {STATUS_LABELS[job.status]}
              </Badge>
            </div>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              {job.customer_name || "No customer"}{job.brand ? ` — ${job.brand}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
              title="Delete this job permanently"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Delete
            </Button>
            <Select
              value={job.status}
              onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
              className="w-[160px]"
              disabled={isPending}
            >
              {(Object.keys(STATUS_LABELS) as JobStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

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

      {/* Progress Bar */}
      <div className="mb-6 p-4 card-surface">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Progress</span>
          <span className="text-sm text-[var(--muted-foreground)]">{pct}%</span>
        </div>
        <div className="w-full h-3 bg-[var(--muted)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: pct === 100 ? "var(--success, #22c55e)" : "var(--primary)",
            }}
          />
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 card-surface">
        <MetaItem label="Spec" value={job.spec_string} />
        <MetaItem label="Floors" value={job.floors?.toString()} />
        <MetaItem label="Door Type" value={job.door_type} />
        <MetaItem label="Drive Type" value={job.drive_type} />
        <MetaItem label="Capacity" value={job.capacity} />
        <MetaItem label="Structure" value={job.structure_included} />
        <MetaItem label="Door Finish" value={job.door_finish} />
        <MetaItem label="Location" value={job.location} />
        <MetaItem label="Mobile" value={job.mobile_number} />
        <MetaItem label="Brand" value={job.brand} />
        <MetaItem
          label="Order Date"
          value={job.order_date ? new Date(job.order_date).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Expected Delivery"
          value={job.expected_delivery ? new Date(job.expected_delivery).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Planned Start"
          value={job.planned_start ? new Date(job.planned_start).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Planned End"
          value={job.planned_end ? new Date(job.planned_end).toLocaleDateString("en-IN") : null}
        />
        <MetaItem label="Sent (dispatched)" value={STAGE_LABELS[job.stage ?? "new"]} />
        <MetaItem label="Required" value={job.requirement_stage ? STAGE_LABELS[job.requirement_stage] : null} />
        <MetaItem
          label="Req. Dispatch Date"
          value={job.requirement_dispatch_date ? new Date(job.requirement_dispatch_date).toLocaleDateString("en-IN") : null}
        />
      </div>

      {job.remark && (
        <div className="mb-6 p-4 card-surface">
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Bill of Materials</h2>
            {(hasSectionBom && hasItemBom) && (
              <div className="flex gap-1 mt-2">
                <button
                  className={`px-3 py-1 text-sm rounded-md transition-colors cursor-pointer ${
                    viewTab === "sections"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setViewTab("sections")}
                >
                  By Section ({bomSectionLines.length})
                </button>
                <button
                  className={`px-3 py-1 text-sm rounded-md transition-colors cursor-pointer ${
                    viewTab === "items"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setViewTab("items")}
                >
                  By Item ({itemBomLines.length})
                </button>
              </div>
            )}
          </div>
          {viewTab === "items" && hasItemBom && (
            <div className="relative w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
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
            <div className="space-y-6">
              {sectionData.map((phase) => (
                <div key={phase.phase}>
                  <h3 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
                    {phase.phase}
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {phase.sections.map((sec) => (
                      <div
                        key={sec.category}
                        className="card-surface p-4"
                      >
                        <h4 className="font-medium text-sm mb-2 flex items-center gap-2 flex-wrap">
                          {sec.category}
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 border ${
                              dispatchPhaseOf(sec.category) === "first"
                                ? "text-blue-700 bg-blue-50 border-blue-200"
                                : "text-[var(--muted-foreground)] bg-[var(--muted)] border-[var(--border)]"
                            }`}
                            title="Dispatch phase"
                          >
                            {dispatchPhaseOf(sec.category) === "first" ? "1st phase" : "2nd phase"}
                          </span>
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
            <div className="card-surface p-8 text-center">
              <p className="text-[var(--muted-foreground)] mb-3">
                No section-based BOM data yet.
              </p>
              <Button
                variant="secondary"
                onClick={() => router.push(`/jobs/${job.id}/edit`)}
              >
                <Pencil className="h-4 w-4 mr-1" />
                Add BOM Data
              </Button>
            </div>
          )
        )}

        {/* Item View */}
        {viewTab === "items" && (
          hasItemBom ? (
            <div className="card-surface overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader label="Code" sortField="code" />
                    <SortHeader label="Item" sortField="name" />
                    <SortHeader label="Category" sortField="category" />
                    <SortHeader label="Required" sortField="required" />
                    <SortHeader label="Issued" sortField="issued" />
                    <TableHead>Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedBom.map((line) => {
                    const remaining = line.required_quantity - line.issued_quantity;
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">{line.item?.code ?? "-"}</TableCell>
                        <TableCell className="font-medium text-sm">
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            {line.item?.name ?? "-"}
                            {dispatchPhaseOf(line.category ?? "") === "first" && (
                              <span
                                className="text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 border text-blue-700 bg-blue-50 border-blue-200"
                                title="First-phase dispatch item"
                              >
                                1st phase
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{line.item?.category?.name ?? "-"}</TableCell>
                        <TableCell className="text-right font-medium">
                          {Number(line.required_quantity).toLocaleString()}{" "}
                          <span className="text-xs text-[var(--muted-foreground)]">{line.item?.uom?.abbreviation}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm">{Number(line.issued_quantity).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={remaining > 0 ? "text-amber-600" : "text-green-600"}>
                            {remaining > 0 ? remaining.toLocaleString() : "Done"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="card-surface p-8 text-center">
              <p className="text-[var(--muted-foreground)]">
                No item-based BOM data. Import from Excel to populate.
              </p>
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
