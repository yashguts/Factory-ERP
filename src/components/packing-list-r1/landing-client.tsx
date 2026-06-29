"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  readParam,
  readIntParam,
  useUrlListSync,
} from "@/lib/hooks/use-url-list-state";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import {
  PackageCheck, Pencil, Search, ChevronLeft, ChevronRight, ArrowUpDown, CheckCircle2,
} from "lucide-react";
import { DRIVE_TYPES, driveTypeLabel } from "@/lib/bom/section-gating";
import type { R1ListSummary } from "@/lib/actions/packing-list-r1";

interface SlimJob {
  id: string;
  job_number: string;
  customer_name: string | null;
  brand: string | null;
  drive_type: string | null;
  spec_string: string | null;
  location: string | null;
}

// A row = a job + the state of its R1 packing list. "none" = not started yet.
type R1State = "none" | "draft" | "final";
interface Row {
  id: string;
  job_number: string;
  customer_name: string | null;
  brand: string | null;
  drive_type: string | null;
  spec_string: string | null;
  location: string | null;
  state: R1State;
  lineCount: number;
  updatedAt: string | null;
}

const STATE_LABEL: Record<R1State, string> = {
  none: "Not started",
  draft: "Draft",
  final: "Final",
};

type SortKey = "job_number" | "customer" | "state" | "lines" | "updated";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

export function LandingClient({
  lists,
  jobs,
}: {
  lists: R1ListSummary[];
  jobs: SlimJob[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  // Merge: every job, annotated with its R1 list state (or "none").
  const rows = useMemo<Row[]>(() => {
    const byJob = new Map(lists.map((l) => [l.jobId, l]));
    return jobs.map((j) => {
      const l = byJob.get(j.id);
      return {
        id: j.id,
        job_number: j.job_number,
        customer_name: j.customer_name,
        brand: j.brand,
        drive_type: j.drive_type,
        spec_string: j.spec_string,
        location: j.location,
        state: (l ? l.status : "none") as R1State,
        lineCount: l?.lineCount ?? 0,
        updatedAt: l?.updatedAt ?? null,
      };
    });
  }, [lists, jobs]);

  const [view, setView] = useState<"all" | "draft" | "final" | "none">(
    () => readParam(sp, "view", "all", ["all", "draft", "final", "none"]) as "all" | "draft" | "final" | "none",
  );
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [driveTypeFilter, setDriveTypeFilter] = useState<string>(() => readParam(sp, "drive", "all"));
  const [brandFilter, setBrandFilter] = useState<string>(() => readParam(sp, "brand", "all"));
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "updated", ["job_number", "customer", "state", "lines", "updated"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "desc", ["asc", "desc"]) as SortDir,
  );
  const [page, setPage] = useState(() => readIntParam(sp, "page", 1));

  useUrlListSync(
    { view, q: search, drive: driveTypeFilter, brand: brandFilter, sort: sortKey, dir: sortDir, page },
    { view: "all", q: "", drive: "all", brand: "all", sort: "updated", dir: "desc", page: 1 },
  );

  // Tab buckets across ALL rows (independent of the other filters).
  const { allCount, draftCount, finalCount, noneCount } = useMemo(() => {
    let d = 0, f = 0, n = 0;
    for (const r of rows) {
      if (r.state === "draft") d++;
      else if (r.state === "final") f++;
      else n++;
    }
    return { allCount: rows.length, draftCount: d, finalCount: f, noneCount: n };
  }, [rows]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.brand) set.add(r.brand); });
    return Array.from(set).sort();
  }, [rows]);

  const driveTypeOptions = useMemo(() => {
    const canonical = DRIVE_TYPES.map((d) => d.value);
    const extras = new Set<string>();
    rows.forEach((r) => {
      if (r.drive_type && !canonical.includes(r.drive_type)) extras.add(r.drive_type);
    });
    return [...canonical, ...Array.from(extras).sort()];
  }, [rows]);

  const searchTokens = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (view !== "all" && r.state !== view) return false;
      if (searchTokens.length > 0) {
        const haystack = [r.job_number, r.customer_name, r.location, r.spec_string, r.brand]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        for (const t of searchTokens) if (!haystack.includes(t)) return false;
      }
      if (driveTypeFilter !== "all" && r.drive_type !== driveTypeFilter) return false;
      if (brandFilter !== "all" && r.brand !== brandFilter) return false;
      return true;
    });
  }, [rows, view, searchTokens, driveTypeFilter, brandFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const stateRank: Record<R1State, number> = { none: 0, draft: 1, final: 2 };
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "job_number":
          cmp = a.job_number.localeCompare(b.job_number, undefined, { numeric: true });
          break;
        case "customer":
          cmp = (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
          break;
        case "state":
          cmp = stateRank[a.state] - stateRank[b.state];
          break;
        case "lines":
          cmp = a.lineCount - b.lineCount;
          break;
        case "updated":
          cmp = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
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
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "updated" || key === "lines" ? "desc" : "asc"); }
  };

  const SortHeader = ({ label, sortField, className }: { label: string; sortField: SortKey; className?: string }) => (
    <TableHead
      className={"cursor-pointer select-none hover:bg-[var(--muted)] transition-colors " + (className ?? "")}
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={sortKey === sortField ? "text-[var(--primary)]" : "opacity-30"} />
      </span>
    </TableHead>
  );

  return (
    <div>
      <PageHeader
        title="Packing List R1"
        meta={
          <>
            {sorted.length} of {allCount} jobs
            <span className="mx-1.5 text-[var(--border-strong)]">·</span>
            <span className="text-green-700 font-medium">{finalCount} final</span>
            <span className="mx-1 text-[var(--muted-foreground)]">/</span>
            <span className="text-amber-700">{draftCount} draft</span>
          </>
        }
        icon={<PackageCheck size={18} />}
        actions={
          <>
            <Link href="/packing-list-r1/template">
              <Button variant="secondary" size="sm">
                <Pencil size={15} className="mr-1.5" /> Edit Template
              </Button>
            </Link>
            <ExportButton
              rows={sorted}
              filename="packing-list-r1"
              sheetName="Packing List R1"
              columns={[
                { header: "Job #", field: "job_number" },
                { header: "Customer", field: (r) => r.customer_name ?? "" },
                { header: "Brand", field: (r) => r.brand ?? "" },
                { header: "Spec", field: (r) => r.spec_string ?? "" },
                { header: "Drive", field: (r) => (r.drive_type ? driveTypeLabel(r.drive_type) : "") },
                { header: "R1 Status", field: (r) => STATE_LABEL[r.state] },
                { header: "Lines", field: (r) => r.lineCount },
                { header: "Updated", field: (r) => (r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "") },
              ]}
            />
          </>
        }
      />

      {/* Tabs: R1 lifecycle. "Final" = packing list completed & locked. */}
      <Tabs
        variant="underline"
        className="mb-3"
        value={view}
        onChange={(v) => { setView(v as "all" | "draft" | "final" | "none"); resetPage(); }}
        tabs={[
          { value: "all", label: "All", count: allCount },
          { value: "draft", label: "Draft", count: draftCount },
          { value: "final", label: "Final", count: finalCount },
          { value: "none", label: "Not started", count: noneCount },
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
      </Toolbar>

      {paginated.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<PackageCheck size={40} />}
            title={rows.length === 0 ? "No jobs yet" : "No jobs match your filters"}
            description={rows.length === 0 ? "Create a job first, then build its packing list." : "Try clearing the search or filters."}
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
                <TableHead>Drive</TableHead>
                <SortHeader label="R1 Status" sortField="state" />
                <SortHeader label="Lines" sortField="lines" className="text-right" />
                <SortHeader label="Updated" sortField="updated" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-[var(--muted)]"
                  onClick={() => router.push(`/packing-list-r1/${r.id}`)}
                >
                  <TableCell className="font-mono text-sm font-medium">{r.job_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.customer_name || "-"}</div>
                    {r.brand && (
                      <div className="text-xs text-[var(--muted-foreground)]">{r.brand}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.spec_string ? <span className="font-mono text-xs">{r.spec_string}</span> : "-"}
                  </TableCell>
                  <TableCell>
                    {r.drive_type ? (
                      <span className="text-xs">{driveTypeLabel(r.drive_type)}</span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.state === "final" ? (
                      <Badge variant="green">
                        <CheckCircle2 size={11} className="mr-1" /> Final
                      </Badge>
                    ) : r.state === "draft" ? (
                      <Badge variant="amber">Draft</Badge>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">Not started</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.state === "none" ? <span className="text-[var(--muted-foreground)]">—</span> : r.lineCount}
                  </TableCell>
                  <TableCell className="text-right text-xs text-[var(--muted-foreground)]">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
