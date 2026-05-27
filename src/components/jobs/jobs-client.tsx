"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Search, Upload, ClipboardList, ChevronLeft, ChevronRight, ArrowUpDown, Plus, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { Job, JobStatus, JobStage } from "@/lib/supabase/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<JobStatus, string> = {
  draft: "bg-gray-100 text-gray-800",
  planned: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const STAGE_LABELS: Record<JobStage, string> = {
  new: "New",
  first_phase_dispatched: "1st Phase",
  second_phase_dispatched: "2nd Phase",
  full_dispatched: "Full Dispatched",
};

const STAGE_COLORS: Record<JobStage, string> = {
  new: "bg-gray-100 text-gray-800",
  first_phase_dispatched: "bg-blue-100 text-blue-800",
  second_phase_dispatched: "bg-purple-100 text-purple-800",
  full_dispatched: "bg-green-100 text-green-800",
};

type SortKey = "job_number" | "customer" | "progress" | "delivery" | "status" | "stage" | "req_stage" | "req_dispatch";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

interface Props {
  initialJobs: Job[];
  unmatchedCount?: number;
}

export function JobsClient({ initialJobs, unmatchedCount = 0 }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<JobStage | "all">("all");
  const [doorTypeFilter, setDoorTypeFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("job_number");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const doorTypes = useMemo(() => {
    const set = new Set<string>();
    initialJobs.forEach((j) => { if (j.door_type) set.add(j.door_type); });
    return Array.from(set).sort();
  }, [initialJobs]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    initialJobs.forEach((j) => { if (j.brand) set.add(j.brand); });
    return Array.from(set).sort();
  }, [initialJobs]);

  const filtered = useMemo(() => {
    return initialJobs.filter((job) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          job.job_number.toLowerCase().includes(q) ||
          (job.customer_name?.toLowerCase().includes(q) ?? false) ||
          (job.location?.toLowerCase().includes(q) ?? false) ||
          (job.spec_string?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (stageFilter !== "all" && job.stage !== stageFilter) return false;
      if (doorTypeFilter !== "all" && job.door_type !== doorTypeFilter) return false;
      if (brandFilter !== "all" && job.brand !== brandFilter) return false;
      return true;
    });
  }, [initialJobs, search, statusFilter, stageFilter, doorTypeFilter, brandFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "job_number":
          cmp = a.job_number.localeCompare(b.job_number, undefined, { numeric: true });
          break;
        case "customer":
          cmp = (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
          break;
        case "progress":
          cmp = (a.progress ?? 0) - (b.progress ?? 0);
          break;
        case "delivery":
          cmp = (a.expected_delivery ?? "").localeCompare(b.expected_delivery ?? "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "stage":
          cmp = (a.stage ?? "new").localeCompare(b.stage ?? "new");
          break;
        case "req_stage":
          cmp = (a.requirement_stage ?? "new").localeCompare(b.requirement_stage ?? "new");
          break;
        case "req_dispatch":
          cmp = (a.requirement_dispatch_date ?? "").localeCompare(b.requirement_dispatch_date ?? "");
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

  const formatProgress = (p: number) => {
    const pct = Math.round((p ?? 0) * 100);
    return pct;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Job Orders</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {sorted.length} of {initialJobs.length} jobs
            {isPending ? " — refreshing..." : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/jobs/new")}>
            <Plus size={16} className="mr-2" />
            New Job
          </Button>
          <Button variant="secondary" onClick={() => router.push("/jobs/import")}>
            <Upload size={16} className="mr-2" />
            Import Excel
          </Button>
        </div>
      </div>

      {/* Unmatched BOM banner */}
      {unmatchedCount > 0 && (
        <Link
          href="/jobs/unmatched"
          className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search job #, customer, location..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-9"
          />
        </div>

        <Select
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

        {brands.length > 0 && (
          <Select
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
      </div>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="border border-[var(--border)] rounded-lg p-12 text-center">
          <ClipboardList size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)]">
            {initialJobs.length === 0
              ? "No jobs yet. Import from Excel to get started."
              : "No jobs match your filters."}
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Job #" sortField="job_number" />
                <SortHeader label="Customer" sortField="customer" />
                <TableHead>Spec</TableHead>
                <SortHeader label="Stage" sortField="stage" />
                <SortHeader label="Req. Stage" sortField="req_stage" />
                <SortHeader label="Req. Dispatch" sortField="req_dispatch" />
                <SortHeader label="Delivery" sortField="delivery" />
                <SortHeader label="Status" sortField="status" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((job) => {
                const pct = formatProgress(job.progress);
                return (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer hover:bg-[var(--muted)]"
                    onClick={() => router.push(`/jobs/${job.id}`)}
                  >
                    <TableCell className="font-mono text-sm font-medium">{job.job_number}</TableCell>
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
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${STAGE_COLORS[job.stage ?? "new"]}`}>
                        {STAGE_LABELS[job.stage ?? "new"]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${STAGE_COLORS[job.requirement_stage ?? "new"]}`}>
                        {STAGE_LABELS[job.requirement_stage ?? "new"]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.requirement_dispatch_date
                        ? new Date(job.requirement_dispatch_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })
                        : "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.expected_delivery
                        ? new Date(job.expected_delivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status]}`}>
                        {STATUS_LABELS[job.status]}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
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
