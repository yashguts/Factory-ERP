"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  readParam,
  readIntParam,
  useUrlListSync,
} from "@/lib/hooks/use-url-list-state";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { Tabs } from "@/components/ui/tabs";
import { ExportButton } from "@/components/ui/export-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, Upload, ClipboardList, ChevronLeft, ChevronRight, ArrowUpDown, Plus, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { updateJob, type JobReadinessFlags } from "@/lib/actions/jobs";
import { changeJobStatus, getOpenStatusAlerts } from "@/lib/actions/job-status";
import { useOperator } from "@/lib/jobs/use-operator";
import { reasonRequired, alertKind, ALERT_META } from "@/lib/jobs/status-alert";
import type { DispatchStatus } from "@/lib/actions/dispatch";
import type { Job, JobStatus, JobStage } from "@/lib/supabase/types";
import { DispatchPlanBoard } from "@/components/jobs/dispatch-plan-board";
import { gadAlert } from "@/lib/jobs/gad-alert";
import { DRIVE_TYPES, driveTypeLabel } from "@/lib/bom/section-gating";
import { getR1StatusMap, type R1JobStatus } from "@/lib/actions/r1-bom-sync";
import { getRicardoFinancialsForJobs, type RicardoListSummary } from "@/lib/actions/ricardo";

// Compact rupee display for the CRM column: lakhs/crores keep the cell narrow.
function fmtL(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  return `₹${new Intl.NumberFormat("en-IN").format(Math.round(n))}`;
}

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

const STATUS_SELECT_COLORS: Record<JobStatus, string> = {
  new: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  in_production: "bg-amber-50 text-amber-700",
  hold: "bg-red-50 text-red-700",
};

// Dispatch is two phases plus a terminal "fully dispatched" state. "Full
// material" is the 2nd (final) phase — labelled "2nd phase" so Sent/Required
// read consistently with the Dispatch Plan. As Sent: which phase has gone out;
// as Required: which phase the job needs next.
const STAGE_LABELS: Record<JobStage, string> = {
  new: "New",
  first_phase: "1st phase",
  full_material: "2nd phase",
};

const STAGE_BADGE: Record<JobStage, BadgeVariant> = {
  new: "neutral",
  first_phase: "blue",
  full_material: "green",
};

const STAGE_SELECT_COLORS: Record<JobStage, string> = {
  new: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  first_phase: "bg-blue-50 text-blue-700",
  full_material: "bg-emerald-50 text-emerald-700",
};

// Structure (factory-made / site-fabricated / none) shown per job. NA renders muted.
const STRUCTURE_BADGE: Record<string, BadgeVariant> = {
  "Factory-made": "blue",
  "Site-fabricated": "amber",
};

type SortKey = "job_number" | "customer" | "status" | "stage" | "req_stage" | "req_dispatch";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

interface Props {
  initialJobs: Job[];
  unmatchedCount?: number;
  dispatchStatus?: Record<string, DispatchStatus>;
  readiness?: JobReadinessFlags;
}

export function JobsClient({
  initialJobs,
  unmatchedCount = 0,
  dispatchStatus = {},
  readiness = { bomJobIds: [], cabinJobNumbers: [], cabinReadyJobNumbers: [] },
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  // R1 list status per job (Final / Audited label under the Spec). Client-
  // fetched — the (parallel-owned) server page needs no new props; one tiny read.
  const [r1Status, setR1Status] = useState<Record<string, R1JobStatus>>({});
  useEffect(() => {
    let alive = true;
    getR1StatusMap()
      .then((m) => {
        if (alive) setR1Status(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Ricardo CRM money per job number (contract / received / transport scope).
  // Client-fetched in one batch call — live from the CRM, never blocks the list.
  const [crm, setCrm] = useState<Record<string, RicardoListSummary>>({});
  useEffect(() => {
    let alive = true;
    getRicardoFinancialsForJobs(initialJobs.map((j) => j.job_number))
      .then((m) => {
        if (alive) setCrm(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [initialJobs]);
  // Optimistic local copy so inline edits are instant
  const [jobs, setJobs] = useState(initialJobs);
  // Track which individual row is saving (doesn't block other rows)
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  // List state lives in the URL too, so Back from a job restores the view.
  const sp = useSearchParams();
  // Tab: active jobs vs. fully-dispatched ones (a job leaves "Active" once every
  // BOM line is fully dispatched — dispatchStatus === "full"). The "plan" tab is
  // a week-by-week dispatch board over the SAME active set (no extra data).
  const [view, setView] = useState<"active" | "dispatched" | "plan">(
    () => readParam(sp, "view", "active", ["active", "dispatched", "plan"]) as "active" | "dispatched" | "plan",
  );
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">(
    () => readParam(sp, "status", "all", ["all", "new", "in_production", "hold"]) as JobStatus | "all",
  );
  const [stageFilter, setStageFilter] = useState<JobStage | "all">(
    () => readParam(sp, "stage", "all", ["all", "new", "first_phase", "full_material"]) as JobStage | "all",
  );
  const [doorTypeFilter, setDoorTypeFilter] = useState<string>(() => readParam(sp, "door", "all"));
  const [driveTypeFilter, setDriveTypeFilter] = useState<string>(() => readParam(sp, "drive", "all"));
  const [brandFilter, setBrandFilter] = useState<string>(() => readParam(sp, "brand", "all"));
  const [structureFilter, setStructureFilter] = useState<string>(
    () => readParam(sp, "structure", "all", ["all", "Factory-made", "Site-fabricated", "NA"]),
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "req_dispatch", ["job_number", "customer", "status", "stage", "req_stage", "req_dispatch"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "asc", ["asc", "desc"]) as SortDir,
  );
  const [page, setPage] = useState(() => readIntParam(sp, "page", 1));

  useUrlListSync(
    { view, q: search, status: statusFilter, stage: stageFilter, door: doorTypeFilter, drive: driveTypeFilter, brand: brandFilter, structure: structureFilter, sort: sortKey, dir: sortDir, page },
    { view: "active", q: "", status: "all", stage: "all", door: "all", drive: "all", brand: "all", structure: "all", sort: "req_dispatch", dir: "asc", page: 1 },
  );

  // Tab buckets (computed across ALL jobs, independent of the other filters, so
  // the counts on the tabs always reflect the true split).
  const { activeCount, dispatchedCount } = useMemo(() => {
    let a = 0, d = 0;
    for (const j of jobs) {
      if ((dispatchStatus[j.id] ?? "none") === "full") d++;
      else a++;
    }
    return { activeCount: a, dispatchedCount: d };
  }, [jobs, dispatchStatus]);

  // Jobs whose GAD was changed after the BOM was defined (and not re-audited).
  const gadDriftCount = useMemo(() => jobs.filter(gadAlert).length, [jobs]);

  const doorTypes = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => { if (j.door_type) set.add(j.door_type); });
    return Array.from(set).sort();
  }, [jobs]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => { if (j.brand) set.add(j.brand); });
    return Array.from(set).sort();
  }, [jobs]);

  // Filter options = the full canonical drive-type list (so every type is
  // always selectable, including a new one like R1000 that may have no jobs
  // yet), plus any legacy code still present in the data so a stray job stays
  // findable. No "blank" option — every job has a drive type.
  const driveTypeOptions = useMemo(() => {
    const canonical = DRIVE_TYPES.map((d) => d.value);
    const extras = new Set<string>();
    jobs.forEach((j) => {
      if (j.drive_type && !canonical.includes(j.drive_type)) extras.add(j.drive_type);
    });
    return [...canonical, ...Array.from(extras).sort()];
  }, [jobs]);

  // Multi-token fuzzy search: every word must appear somewhere across
  // job_number / customer / location / spec_string (order-independent).
  const searchTokens = useMemo(
    () =>
      search
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [search],
  );

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      // Tab gate: the "Fully Dispatched" tab shows only fully-dispatched jobs;
      // the "Active" tab shows everything else (never-dispatched + partial).
      const isFull = (dispatchStatus[job.id] ?? "none") === "full";
      if (view === "dispatched" ? !isFull : isFull) return false;
      if (searchTokens.length > 0) {
        const haystack = [
          job.job_number,
          job.customer_name,
          job.location,
          job.spec_string,
          job.brand,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        for (const token of searchTokens) {
          if (!haystack.includes(token)) return false;
        }
      }
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (stageFilter !== "all" && job.stage !== stageFilter) return false;
      if (doorTypeFilter !== "all" && job.door_type !== doorTypeFilter) return false;
      if (driveTypeFilter !== "all" && job.drive_type !== driveTypeFilter) return false;
      if (brandFilter !== "all" && job.brand !== brandFilter) return false;
      if (structureFilter !== "all" && (job.structure_included ?? "NA") !== structureFilter) return false;
      return true;
    });
  }, [jobs, view, dispatchStatus, searchTokens, statusFilter, stageFilter, doorTypeFilter, driveTypeFilter, brandFilter, structureFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      // Dispatch date: undated jobs always sink to the bottom, regardless of
      // sort direction — otherwise blanks would crowd the top of an ascending
      // list and bury the soonest-due jobs.
      if (sortKey === "req_dispatch") {
        const da = a.requirement_dispatch_date ?? "";
        const db = b.requirement_dispatch_date ?? "";
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        const cmp = da.localeCompare(db);
        return sortDir === "asc" ? cmp : -cmp;
      }
      let cmp = 0;
      switch (sortKey) {
        case "job_number":
          cmp = a.job_number.localeCompare(b.job_number, undefined, { numeric: true });
          break;
        case "customer":
          cmp = (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "stage":
          cmp = (a.stage ?? "new").localeCompare(b.stage ?? "new");
          break;
        case "req_stage":
          cmp = (a.requirement_stage ?? "").localeCompare(b.requirement_stage ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const resetPage = () => setPage(1);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const { ensureOperator } = useOperator();
  // job_ids with an OPEN (unacknowledged) status alert → amber "!" chip in the list.
  const [openAlertJobs, setOpenAlertJobs] = useState<Set<string>>(new Set());
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  useEffect(() => {
    let alive = true;
    getOpenStatusAlerts()
      .then((rows) => { if (alive) setOpenAlertJobs(new Set(rows.map((r) => r.job_id))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [statusRefreshKey]);

  // Status changes go through the audited choke-point (records who/when/why + alerts).
  const handleStatusChange = (jobId: string, newStatus: JobStatus) => {
    const job = jobs.find((j) => j.id === jobId);
    const from = (job?.status ?? null) as JobStatus | null;
    if (from === newStatus) return;
    const operator = ensureOperator();
    let reason: string | null = null;
    if (reasonRequired(from, newStatus)) {
      const k = alertKind(from, newStatus);
      const r = window.prompt(`Reason for "${k ? ALERT_META[k].label : "this change"}" on job ${job?.job_number ?? ""} (required):`, "");
      if (r === null || !r.trim()) { toast.error("Status change cancelled — a reason is required."); return; }
      reason = r.trim();
    }
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: newStatus } : j)));
    setSavingJobId(jobId);
    startTransition(async () => {
      try {
        const res = await changeJobStatus(jobId, newStatus, operator, reason);
        if (!res.ok) { toast.error(res.error ?? "Could not change status"); router.refresh(); }
        else if (res.alertKind) toast.success(`${job?.job_number ?? "Job"}: ${ALERT_META[res.alertKind].label}.`);
      } catch {
        toast.error(`Could not change status for ${job?.job_number ?? "job"}.`);
        router.refresh();
      } finally {
        setSavingJobId(null);
        setStatusRefreshKey((k) => k + 1);
      }
    });
  };

  const handleInlineUpdate = (jobId: string, data: Record<string, any>) => {
    const jobNumber = jobs.find((j) => j.id === jobId)?.job_number ?? "";
    // Optimistic: update local state instantly so UI never blocks
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, ...data } : j)),
    );
    setSavingJobId(jobId);
    // Fire-and-forget server save; refresh in background
    startTransition(async () => {
      try {
        await updateJob(jobId, data);
      } catch {
        // Revert on error — reload from server, and SAY so (silently losing
        // the edit made people think the app "forgot" their change).
        toast.error(
          `Could not save the change to job ${jobNumber} — the row has been reset. Please try again.`,
        );
        router.refresh();
      } finally {
        setSavingJobId(null);
      }
    });
  };

  const SortHeader = ({ label, sortField, hint }: { label: string; sortField: SortKey; hint?: string }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-[var(--muted)] transition-colors"
      onClick={() => handleSort(sortField)}
      title={hint}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={sortKey === sortField ? "text-[var(--primary)]" : "opacity-30"} />
      </span>
    </TableHead>
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Job Orders"
        meta={
          <>
            {sorted.length} of {view === "dispatched" ? dispatchedCount : activeCount}{" "}
            {view === "dispatched" ? "fully dispatched" : "active"} jobs
            {savingJobId ? " — saving..." : ""}
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={() => router.push("/jobs/new")}>
              <Plus size={16} className="mr-2" />
              New Job
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push("/jobs/import")}>
              <Upload size={16} className="mr-2" />
              Import Excel
            </Button>
            <ExportButton
              rows={sorted}
              filename={`jobs-${view}`}
              sheetName="Jobs"
              columns={[
                { header: "Job #", field: "job_number" },
                { header: "Customer", field: (j) => j.customer_name ?? "" },
                { header: "Brand", field: (j) => j.brand ?? "" },
                { header: "Location", field: (j) => j.location ?? "" },
                { header: "Spec", field: (j) => j.spec_string ?? "" },
                { header: "Structure", field: (j) => j.structure_included ?? "NA" },
                { header: "Sent", field: (j) => STAGE_LABELS[j.stage ?? "new"] },
                { header: "Required", field: (j) => STAGE_LABELS[j.requirement_stage ?? "new"] },
                { header: "Req. Dispatch", field: (j) => j.requirement_dispatch_date ?? "" },
                { header: "Status", field: (j) => STATUS_LABELS[j.status] },
                {
                  header: "Dispatch",
                  field: (j) => {
                    const st = dispatchStatus[j.id] ?? "none";
                    return st === "full" ? "Dispatched" : st === "partial" ? "Partial" : "";
                  },
                },
                { header: "GAD Alert", field: (j) => (gadAlert(j) ? "CHANGED" : "") },
                { header: "CRM Contract Value", field: (j) => crm[j.job_number]?.contractValue ?? "" },
                { header: "CRM Received (approved)", field: (j) => (crm[j.job_number]?.found ? crm[j.job_number].receivedApproved : "") },
                {
                  header: "CRM Transport",
                  field: (j) => {
                    const s = crm[j.job_number];
                    if (!s?.found) return "";
                    if (s.transportMode === "Customer") return "Customer scope";
                    if (!s.transportMode) return "";
                    return `${s.transportMode}: ${s.transportAmount ?? (s.transportTbd ? "TBD" : "")}`;
                  },
                },
              ]}
            />
          </>
        }
      />

      {/* Unmatched BOM banner */}
      {unmatchedCount > 0 && (
        <Link
          href="/jobs/unmatched"
          className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] hover:opacity-90 transition-colors"
        >
          <AlertTriangle size={18} className="shrink-0" />
          <span className="text-sm">
            <strong>{unmatchedCount}</strong> BOM lines are not mapped to inventory items.
          </span>
          <span className="ml-auto text-sm font-medium underline underline-offset-2">
            Resolve
          </span>
        </Link>
      )}

      {/* GAD-changed-after-BOM banner — links to the global GAD Change Alerts page */}
      {gadDriftCount > 0 && (
        <Link
          href="/jobs/gad-alerts"
          className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg border border-red-300 bg-red-50 text-red-700 hover:opacity-90 transition-colors"
        >
          <AlertTriangle size={18} className="shrink-0" />
          <span className="text-sm">
            <strong>{gadDriftCount}</strong>{" "}
            {gadDriftCount === 1 ? "job has" : "jobs have"} a GAD changed after the BOM was defined — review before cutting/procuring.
          </span>
          <span className="ml-auto text-sm font-medium underline underline-offset-2">
            Review
          </span>
        </Link>
      )}

      {/* Job status alerts banner — links to the global Status Alerts page */}
      {openAlertJobs.size > 0 && (
        <Link
          href="/jobs/status-alerts"
          className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:opacity-90 transition-colors"
        >
          <AlertTriangle size={18} className="shrink-0" />
          <span className="text-sm">
            <strong>{openAlertJobs.size}</strong>{" "}
            {openAlertJobs.size === 1 ? "job has" : "jobs have"} an open status alert (started / held / reverted / resumed) awaiting acknowledgement.
          </span>
          <span className="ml-auto text-sm font-medium underline underline-offset-2">
            Review
          </span>
        </Link>
      )}

      {/* Tabs: Active vs. Fully Dispatched */}
      <Tabs
        variant="underline"
        className="mb-3"
        value={view}
        onChange={(v) => { setView(v as "active" | "dispatched" | "plan"); resetPage(); }}
        tabs={[
          { value: "active", label: "Active", count: activeCount },
          { value: "dispatched", label: "Fully Dispatched", count: dispatchedCount },
          { value: "plan", label: "Dispatch Plan", count: activeCount },
        ]}
      />

      {/* Filters */}
      <Toolbar>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search job #, customer, location..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-8"
          />
        </div>

        <Select
          size="sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as JobStatus | "all"); resetPage(); }}
          className="w-[150px]"
        >
          <option value="all">All Status</option>
          {(Object.keys(STATUS_LABELS) as JobStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </Select>

        <Select
          size="sm"
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value as JobStage | "all"); resetPage(); }}
          className="w-[150px]"
        >
          <option value="all">All Stages</option>
          {(Object.keys(STAGE_LABELS) as JobStage[]).map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </Select>

        {doorTypes.length > 0 && (
          <Select
            size="sm"
            value={doorTypeFilter}
            onChange={(e) => { setDoorTypeFilter(e.target.value); resetPage(); }}
            className="w-[140px]"
          >
            <option value="all">All Door Types</option>
            {doorTypes.map((dt) => (
              <option key={dt} value={dt}>{dt}</option>
            ))}
          </Select>
        )}

        <Select
          size="sm"
          value={driveTypeFilter}
          onChange={(e) => { setDriveTypeFilter(e.target.value); resetPage(); }}
          className="w-[160px]"
          title="Filter by drive type"
        >
          <option value="all">All Drive Types</option>
          {driveTypeOptions.map((dt) => (
            <option key={dt} value={dt}>{driveTypeLabel(dt)}</option>
          ))}
        </Select>

        {brands.length > 0 && (
          <Select
            size="sm"
            value={brandFilter}
            onChange={(e) => { setBrandFilter(e.target.value); resetPage(); }}
            className="w-[140px]"
          >
            <option value="all">All Brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </Select>
        )}

        <Select
          size="sm"
          value={structureFilter}
          onChange={(e) => { setStructureFilter(e.target.value); resetPage(); }}
          className="w-[150px]"
          title="Filter by structure supply"
        >
          <option value="all">All Structure</option>
          <option value="Factory-made">Factory-made</option>
          <option value="Site-fabricated">Site-fabricated</option>
          <option value="NA">No structure</option>
        </Select>
      </Toolbar>

      {/* Week-by-week dispatch board (visual of the same active set) */}
      {view === "plan" ? (
        <DispatchPlanBoard jobs={sorted} dispatchStatus={dispatchStatus} readiness={readiness} />
      ) : /* Table */ paginated.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<ClipboardList size={40} />}
            title={
              initialJobs.length === 0
                ? "No jobs yet"
                : view === "dispatched" && dispatchedCount === 0
                  ? "No fully dispatched jobs yet"
                  : "No jobs match your filters"
            }
            description={
              initialJobs.length === 0
                ? "Import from Excel to get started."
                : view === "dispatched" && dispatchedCount === 0
                  ? "A job moves here once every BOM line has been dispatched."
                  : "Try clearing the search or filters."
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <SortHeader label="Job #" sortField="job_number" />
                <SortHeader label="Customer" sortField="customer" />
                <TableHead>Spec</TableHead>
                <TableHead title="Live from Ricardo CRM — money received (approved) / contract value, plus transport scope. Only Ricardo jobs.">CRM ₹</TableHead>
                <TableHead title="Structure supply: Factory-made / Site-fabricated / none">Structure</TableHead>
                <SortHeader
                  label="Sent"
                  sortField="stage"
                  hint="Material already dispatched to site. Moves forward automatically when you record a dispatch on the job."
                />
                <SortHeader
                  label="Required"
                  sortField="req_stage"
                  hint="What this job needs prepared next (set by the office). Drives the MRP requirement."
                />
                <SortHeader
                  label="Req. Dispatch"
                  sortField="req_dispatch"
                  hint="Date the required material must go out. MRP's date filter uses this."
                />
                <SortHeader label="Status" sortField="status" />
                <TableHead>Dispatch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((job) => (
                <TableRow
                  key={job.id}
                  className="cursor-pointer hover:bg-[var(--muted)]"
                  onClick={() => router.push(`/jobs/${job.id}`)}
                >
                  <TableCell className="font-mono text-sm font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {job.job_number}
                      {gadAlert(job) && (
                        <span
                          title="GAD changed after the BOM was defined — open the job to review and Mark Audited"
                          className="inline-flex items-center gap-0.5 rounded bg-red-600 px-1 py-0.5 text-[10px] font-bold leading-none text-white"
                        >
                          <AlertTriangle size={10} />
                          GAD
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{job.customer_name || "-"}</div>
                    {job.brand && (
                      <div className="text-xs text-[var(--muted-foreground)]">{job.brand}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.spec_string ? (
                      <span className="font-mono text-xs">{job.spec_string}</span>
                    ) : "-"}
                    {r1Status[job.id]?.status === "final" && (
                      <div className="mt-0.5">
                        {r1Status[job.id].audited_at ? (
                          <span
                            className="inline-flex items-center rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium leading-none text-emerald-700"
                            title={`Packing List R1 marked Final and Audited on ${new Date(r1Status[job.id].audited_at!).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                          >
                            R1 ✓ Audited{" "}
                            {new Date(r1Status[job.id].audited_at!).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center rounded border border-emerald-300 px-1 py-0.5 text-[10px] font-medium leading-none text-emerald-700"
                            title="Packing List R1 marked Final (not yet audited)"
                          >
                            R1 Final
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const s = crm[job.job_number];
                      if (!s)
                        return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
                      if (!s.found)
                        return (
                          <span
                            className="text-[10px] text-amber-600"
                            title="No live job found in the Ricardo CRM for this number"
                          >
                            not in CRM
                          </span>
                        );
                      const transport =
                        s.transportMode === "Customer"
                          ? "Transport: customer"
                          : s.transportMode
                            ? `Transport: ${s.transportAmount != null ? fmtL(s.transportAmount) : s.transportTbd ? "TBD" : "company"}`
                            : null;
                      return (
                        <div
                          className="whitespace-nowrap leading-tight"
                          title={`Ricardo CRM (live): received ₹${new Intl.NumberFormat("en-IN").format(s.receivedApproved)} approved of ₹${new Intl.NumberFormat("en-IN").format(s.contractValue ?? 0)} contract${s.transportMode ? ` · transport: ${s.transportMode}` : ""}${s.isAudited ? " · job audited" : ""}`}
                        >
                          <span className="text-xs font-medium text-emerald-700">
                            {fmtL(s.receivedApproved)}
                          </span>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {" "}/ {fmtL(s.contractValue)}
                          </span>
                          {transport && (
                            <div className="text-[10px] text-[var(--muted-foreground)]">
                              {transport}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {job.structure_included && job.structure_included !== "NA" ? (
                      <Badge variant={STRUCTURE_BADGE[job.structure_included] ?? "neutral"}>
                        {job.structure_included}
                      </Badge>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <select
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-[var(--ring)] focus:outline-none ${STAGE_SELECT_COLORS[job.stage ?? "new"]}`}
                      value={job.stage ?? "new"}
                      onChange={(e) => handleInlineUpdate(job.id, { stage: e.target.value })}
                      disabled={savingJobId === job.id}
                    >
                      {(Object.keys(STAGE_LABELS) as JobStage[]).map((s) => (
                        <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <select
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-[var(--ring)] focus:outline-none ${STAGE_SELECT_COLORS[job.requirement_stage ?? "new"]}`}
                      value={job.requirement_stage ?? "new"}
                      onChange={(e) => handleInlineUpdate(job.id, { requirement_stage: e.target.value as JobStage })}
                      disabled={savingJobId === job.id}
                    >
                      {(Object.keys(STAGE_LABELS) as JobStage[]).map((s) => (
                        <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      className="text-xs bg-transparent border border-[var(--border)] rounded px-2 py-1 w-[130px] cursor-pointer hover:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] focus:outline-none transition-colors"
                      value={job.requirement_dispatch_date ?? ""}
                      onChange={(e) => handleInlineUpdate(job.id, { requirement_dispatch_date: e.target.value || null })}
                      disabled={savingJobId === job.id}
                    />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <select
                        className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-[var(--ring)] focus:outline-none ${STATUS_SELECT_COLORS[job.status]}`}
                        value={job.status}
                        onChange={(e) => handleStatusChange(job.id, e.target.value as JobStatus)}
                        disabled={savingJobId === job.id}
                      >
                        {(Object.keys(STATUS_LABELS) as JobStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      {openAlertJobs.has(job.id) && (
                        <Link href="/jobs/status-alerts" onClick={(e) => e.stopPropagation()} title="Open status alert — review &amp; acknowledge" className="shrink-0 rounded-full bg-amber-500/20 px-1.5 font-bold text-amber-600 hover:bg-amber-500/30">!</Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const st = dispatchStatus[job.id] ?? "none";
                      if (st === "none")
                        return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
                      return (
                        <Badge variant={st === "full" ? "green" : "amber"}>
                          {st === "full" ? "Dispatched" : "Partial"}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {view !== "plan" && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1}>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-sm font-medium">{page} / {totalPages}</span>
            <Button variant="secondary" size="sm" onClick={() => setPage(page + 1)} disabled={page === totalPages}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
