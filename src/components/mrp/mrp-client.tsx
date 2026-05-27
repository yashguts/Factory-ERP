"use client";

import { useState, useMemo, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Search, Calculator, ChevronLeft, ChevronRight, ArrowUpDown, CalendarDays } from "lucide-react";
import type { MrpRow } from "@/lib/actions/mrp";
import type { ItemType } from "@/lib/supabase/types";

const TYPE_LABELS: Record<string, string> = {
  raw_material: "Raw Material",
  sub_assembly: "Sub Assembly",
  finished_good: "Finished Good",
  mechanical_finished_stock: "Mech. Finished Stock",
  door_panel: "Door Panel",
};

const TYPE_COLORS: Record<string, string> = {
  raw_material: "bg-blue-100 text-blue-800",
  sub_assembly: "bg-purple-100 text-purple-800",
  finished_good: "bg-green-100 text-green-800",
  mechanical_finished_stock: "bg-amber-100 text-amber-800",
  door_panel: "bg-pink-100 text-pink-800",
};

type SortKey = "code" | "name" | "category" | "required" | "stock" | "shortfall" | "jobs";
type SortDir = "asc" | "desc";
type ShortfallFilter = "all" | "shortfall" | "excess" | "zero";

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

  const totals = useMemo(() => {
    let totalRequired = 0;
    let totalShortfall = 0;
    let itemsWithShortfall = 0;
    for (const row of initialData) {
      totalRequired += row.total_required;
      totalShortfall += row.shortfall;
      if (row.shortfall > 0) itemsWithShortfall++;
    }
    return { totalRequired, totalShortfall, itemsWithShortfall, totalItems: initialData.length };
  }, [initialData]);

  const filtered = useMemo(() => {
    return initialData.filter((row) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          row.item_code.toLowerCase().includes(q) ||
          row.item_name.toLowerCase().includes(q) ||
          (row.category_name?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      if (typeFilter !== "all" && row.item_type !== typeFilter) return false;
      if (shortfallFilter === "shortfall" && row.shortfall <= 0) return false;
      if (shortfallFilter === "excess" && row.total_stock <= row.total_required) return false;
      if (shortfallFilter === "zero" && row.shortfall !== 0) return false;
      return true;
    });
  }, [initialData, search, typeFilter, shortfallFilter]);

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">MRP - Material Requirements</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {sorted.length} of {initialData.length} items
            {cutoffDate && ` — up to ${new Date(cutoffDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
            {isPending ? " — refreshing..." : ""}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="border border-[var(--border)] rounded-lg p-4">
          <p className="text-xs text-[var(--muted-foreground)] mb-1">Total Items</p>
          <p className="text-2xl font-bold">{totals.totalItems.toLocaleString()}</p>
        </div>
        <div className="border border-[var(--border)] rounded-lg p-4">
          <p className="text-xs text-[var(--muted-foreground)] mb-1">Total Required</p>
          <p className="text-2xl font-bold">{totals.totalRequired.toLocaleString()}</p>
        </div>
        <div className="border border-[var(--border)] rounded-lg p-4">
          <p className="text-xs text-[var(--muted-foreground)] mb-1">Items with Shortfall</p>
          <p className="text-2xl font-bold text-[var(--destructive)]">{totals.itemsWithShortfall.toLocaleString()}</p>
        </div>
        <div className="border border-[var(--border)] rounded-lg p-4">
          <p className="text-xs text-[var(--muted-foreground)] mb-1">Total Shortfall Units</p>
          <p className="text-2xl font-bold text-[var(--destructive)]">{totals.totalShortfall.toLocaleString()}</p>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="flex items-center gap-3 mb-4 p-3 border border-[var(--border)] rounded-lg bg-[var(--card)]">
        <CalendarDays size={18} className="text-[var(--muted-foreground)] shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap">Requirement Dispatch Date up to:</span>
        <input
          ref={dateRef}
          type="date"
          value={cutoffDate}
          onChange={(e) => handleDateChange(e.target.value)}
          onClick={() => { try { dateRef.current?.showPicker(); } catch {} }}
          className="flex h-10 w-[200px] rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1 [color-scheme:dark]"
        />
        {cutoffDate && (
          <Button variant="secondary" size="sm" onClick={clearDate}>
            Clear
          </Button>
        )}
        {!cutoffDate && (
          <span className="text-xs text-[var(--muted-foreground)]">
            Showing all jobs (no date filter)
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
        <div className="border border-[var(--border)] rounded-lg p-12 text-center">
          <Calculator size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)]">
            {initialData.length === 0
              ? "No material requirements found. Ensure jobs have BOM lines with mapped items."
              : "No items match your filters."}
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-lg">
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
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[row.item_type] ?? "bg-gray-100 text-gray-800"}`}>
                        {TYPE_LABELS[row.item_type] ?? row.item_type}
                      </span>
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
                      {row.job_count}
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
