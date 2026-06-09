"use client";

import { useState, useMemo, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { Search, Calculator, ChevronLeft, ChevronRight, ArrowUpDown, CalendarDays } from "lucide-react";
import type { MrpRow } from "@/lib/actions/mrp";
import type { ItemType } from "@/lib/supabase/types";
import { MrpJobsPopover } from "@/components/mrp/mrp-jobs-popover";

const TYPE_LABELS: Record<string, string> = {
  raw_material: "Raw Material",
  sub_assembly: "Sub Assembly",
  finished_good: "Finished Good",
  mechanical_finished_stock: "Mech. Finished Stock",
  door_panel: "Door Panel",
};

const TYPE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  raw_material: "blue",
  sub_assembly: "purple",
  finished_good: "green",
  mechanical_finished_stock: "amber",
  door_panel: "pink",
};

type SortKey = "code" | "name" | "category" | "required" | "stock" | "shortfall" | "jobs";
type SortDir = "asc" | "desc";
type ShortfallFilter = "all" | "shortfall" | "excess" | "zero";
type ProcurementTab = "all" | "trade" | "make";

const PAGE_SIZE = 50;

interface Props {
  initialData: MrpRow[];
  initialCutoffDate?: string;
}

export function MrpClient({ initialData, initialCutoffDate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [shortfallFilter, setShortfallFilter] = useState<ShortfallFilter>("all");
  // Top-level Make/Trade split. Defaults to "trade" since procurement is
  // usually the actionable bottleneck — flip to "make" or "all" any time.
  const [procurementTab, setProcurementTab] = useState<ProcurementTab>("trade");
  const [sortKey, setSortKey] = useState<SortKey>("shortfall");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [cutoffDate, setCutoffDate] = useState(initialCutoffDate ?? "");
  const dateRef = useRef<HTMLInputElement>(null);

  const handleDateChange = (date: string) => {
    setCutoffDate(date);
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    startTransition(() => {
      router.push(`/mrp${params.toString() ? `?${params}` : ""}`);
    });
  };

  const clearDate = () => {
    setCutoffDate("");
    startTransition(() => {
      router.push("/mrp");
    });
  };

  // Rows restricted to the active Make/Trade tab. All downstream filters
  // (search, type, shortfall) and the summary card totals are computed
  // off this slice so the page is self-consistent within a tab.
  const tabRows = useMemo(() => {
    if (procurementTab === "all") return initialData;
    return initialData.filter((r) => r.procurement_type === procurementTab);
  }, [initialData, procurementTab]);

  /** Counts per tab — drives the badge numbers on the tab buttons. */
  const tabCounts = useMemo(() => {
    let trade = 0;
    let make = 0;
    for (const r of initialData) {
      if (r.procurement_type === "trade") trade++;
      else if (r.procurement_type === "make") make++;
    }
    return { all: initialData.length, trade, make };
  }, [initialData]);

  const totals = useMemo(() => {
    let totalRequired = 0;
    let totalShortfall = 0;
    let itemsWithShortfall = 0;
    for (const row of tabRows) {
      totalRequired += row.total_required;
      totalShortfall += row.shortfall;
      if (row.shortfall > 0) itemsWithShortfall++;
    }
    return { totalRequired, totalShortfall, itemsWithShortfall, totalItems: tabRows.length };
  }, [tabRows]);

  // Multi-token fuzzy search across code / name / category.
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
    return tabRows.filter((row) => {
      if (searchTokens.length > 0) {
        const haystack = [row.item_code, row.item_name, row.category_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        for (const token of searchTokens) {
          if (!haystack.includes(token)) return false;
        }
      }
      if (typeFilter !== "all" && row.item_type !== typeFilter) return false;
      if (shortfallFilter === "shortfall" && row.shortfall <= 0) return false;
      if (shortfallFilter === "excess" && row.total_stock <= row.total_required) return false;
      if (shortfallFilter === "zero" && row.shortfall !== 0) return false;
      return true;
    });
  }, [tabRows, searchTokens, typeFilter, shortfallFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code":
          cmp = a.item_code.localeCompare(b.item_code);
          break;
        case "name":
          cmp = a.item_name.localeCompare(b.item_name);
          break;
        case "category":
          cmp = (a.category_name ?? "").localeCompare(b.category_name ?? "");
          break;
        case "required":
          cmp = a.total_required - b.total_required;
          break;
        case "stock":
          cmp = a.total_stock - b.total_stock;
          break;
        case "shortfall":
          cmp = a.shortfall - b.shortfall;
          break;
        case "jobs":
          cmp = a.job_count - b.job_count;
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
      setSortDir(key === "shortfall" || key === "required" || key === "jobs" ? "desc" : "asc");
    }
  };

  const SortHeader = ({ label, sortField, className }: { label: string; sortField: SortKey; className?: string }) => (
    <TableHead
      className={`cursor-pointer select-none hover:bg-[var(--muted)] transition-colors ${className ?? ""}`}
      onClick={() => { handleSort(sortField); resetPage(); }}
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MRP - Material Requirements</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {sorted.length} of {tabRows.length} items in this tab
            {cutoffDate && ` — up to ${new Date(cutoffDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
            {isPending ? " — refreshing..." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/mrp/make-plan${cutoffDate ? `?date=${cutoffDate}` : ""}`}>
            <Button variant="secondary">Programs to run →</Button>
          </Link>
          <Link href={`/mrp/plan${cutoffDate ? `?date=${cutoffDate}` : ""}`}>
            <Button variant="secondary">Raw material plan →</Button>
          </Link>
        </div>
      </div>

      {/* Procurement Type Tabs — split MRP into procurement vs production
          planning views. Switching tabs scopes the table, summary cards
          and all downstream filters. */}
      <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
        {([
          { key: "trade", label: "Trade · To Procure", count: tabCounts.trade },
          { key: "make",  label: "Make · To Manufacture", count: tabCounts.make },
          { key: "all",   label: "All", count: tabCounts.all },
        ] as const).map((t) => {
          const active = procurementTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setProcurementTab(t.key); resetPage(); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                active
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
              <span
                className={`ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded-full ${
                  active
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                }`}
              >
                {t.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-1">Total Items</p>
          <p className="text-2xl font-bold tabular-nums">{totals.totalItems.toLocaleString()}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-1">Total Required</p>
          <p className="text-2xl font-bold tabular-nums">{totals.totalRequired.toLocaleString()}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-1">Items with Shortfall</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--destructive)]">{totals.itemsWithShortfall.toLocaleString()}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-1">Total Shortfall Units</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--destructive)]">{totals.totalShortfall.toLocaleString()}</p>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="flex items-center gap-3 mb-4 p-3 card-surface">
        <CalendarDays size={18} className="text-[var(--muted-foreground)] shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap">Requirement Dispatch Date up to:</span>
        <input
          ref={dateRef}
          type="date"
          value={cutoffDate}
          onChange={(e) => handleDateChange(e.target.value)}
          onClick={() => { try { dateRef.current?.showPicker(); } catch {} }}
          className="flex h-10 w-[200px] rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm cursor-pointer hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] focus:ring-offset-1 transition-colors [color-scheme:dark]"
        />
        {cutoffDate && (
          <Button variant="secondary" size="sm" onClick={clearDate}>
            Clear
          </Button>
        )}
        {!cutoffDate && (
          <span className="text-xs text-[var(--muted-foreground)]">
            All in-production jobs — pick a date to limit by requirement dispatch date
          </span>
        )}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search code, name, category..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-9"
          />
        </div>

        <Select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value as ItemType | "all"); resetPage(); }}
          className="w-[170px]"
        >
          <option value="all">All Types</option>
          <option value="raw_material">Raw Material</option>
          <option value="sub_assembly">Sub Assembly</option>
          <option value="finished_good">Finished Good</option>
          <option value="mechanical_finished_stock">Mech. Finished Stock</option>
          <option value="door_panel">Door Panel</option>
        </Select>

        <Select
          value={shortfallFilter}
          onChange={(e) => { setShortfallFilter(e.target.value as ShortfallFilter); resetPage(); }}
          className="w-[160px]"
        >
          <option value="all">All Items</option>
          <option value="shortfall">Shortfall Only</option>
          <option value="excess">Sufficient Only</option>
        </Select>
      </div>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <Calculator size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)]">
            {initialData.length === 0
              ? "No material requirements found. Ensure jobs have BOM lines with mapped items."
              : "No items match your filters."}
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Code" sortField="code" />
                <SortHeader label="Item Name" sortField="name" />
                <TableHead>Type</TableHead>
                <SortHeader label="Category" sortField="category" />
                <SortHeader label="Required" sortField="required" className="text-right" />
                <SortHeader label="In Stock" sortField="stock" className="text-right" />
                <SortHeader label="Shortfall" sortField="shortfall" className="text-right" />
                <SortHeader label="Jobs" sortField="jobs" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((row) => {
                const excess = row.total_stock - row.total_required;
                return (
                  <TableRow key={row.item_id}>
                    <TableCell className="font-mono text-xs">{row.item_code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.item_name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TYPE_BADGE_VARIANT[row.item_type] ?? "neutral"}>
                        {TYPE_LABELS[row.item_type] ?? row.item_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.category_name ?? "-"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.total_required.toLocaleString()}{" "}
                      <span className="text-xs text-[var(--muted-foreground)]">{row.uom_abbreviation}</span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {row.total_stock.toLocaleString()}{" "}
                      <span className="text-xs text-[var(--muted-foreground)]">{row.uom_abbreviation}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {row.shortfall > 0 ? (
                        <span className="text-red-600">
                          -{row.shortfall.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-green-600">
                          +{excess.toLocaleString()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.total_required > 0 ? (
                        <MrpJobsPopover
                          itemId={row.item_id}
                          itemName={row.item_name}
                          uom={row.uom_abbreviation}
                          cutoffDate={cutoffDate || undefined}
                        >
                          <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)]">
                            {row.job_count}
                          </span>
                        </MrpJobsPopover>
                      ) : (
                        row.job_count
                      )}
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
