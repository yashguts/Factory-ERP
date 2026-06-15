"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  readParam,
  readIntParam,
  useUrlListSync,
} from "@/lib/hooks/use-url-list-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, Calculator, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
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
  /**
   * When set, the page is locked to one procurement side (its own sidebar
   * section): the Make/Trade/All tab row is hidden and every total, filter and
   * the toolbar are scoped to this side. Omit for the legacy combined view.
   */
  section?: "make" | "trade";
}

export function MrpClient({ initialData, initialCutoffDate, section }: Props) {
  // Tab + filters live in the URL too (alongside ?date=), so switching to the
  // Programs/Buy-list views and coming back — or pressing Back from a job —
  // restores the exact same view.
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">(
    () => readParam(sp, "type", "all", ["all", "raw_material", "sub_assembly", "finished_good", "mechanical_finished_stock", "door_panel"]) as ItemType | "all",
  );
  const [shortfallFilter, setShortfallFilter] = useState<ShortfallFilter>(
    () => readParam(sp, "show", "all", ["all", "shortfall", "excess", "zero"]) as ShortfallFilter,
  );
  // Top-level Make/Trade split. When the page belongs to a Make-only or
  // Trade-only sidebar section, `section` locks the scope and the tab row is
  // hidden; otherwise it defaults to "trade" (the actionable bottleneck) and the
  // user can flip to "make" or "all".
  const [procurementTab, setProcurementTab] = useState<ProcurementTab>(
    () => section ?? (readParam(sp, "tab", "trade", ["all", "trade", "make"]) as ProcurementTab),
  );
  // On-order / To-buy (outstanding-PO netting) applies to purchased Trade
  // items; hide those columns on the Make tab where POs don't apply.
  const showPo = procurementTab !== "make";
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "shortfall", ["code", "name", "category", "required", "stock", "shortfall", "jobs"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "desc", ["asc", "desc"]) as SortDir,
  );
  const [page, setPage] = useState(() => readIntParam(sp, "page", 1));
  // Date cutoff comes from the URL (?date=); the shared MrpToolbar drives changes.
  const cutoffDate = initialCutoffDate ?? "";

  // When locked to a section the scope lives in the route, so don't write ?tab=.
  useUrlListSync(
    section
      ? { q: search, type: typeFilter, show: shortfallFilter, sort: sortKey, dir: sortDir, page }
      : { q: search, type: typeFilter, show: shortfallFilter, tab: procurementTab, sort: sortKey, dir: sortDir, page },
    section
      ? { q: "", type: "all", show: "all", sort: "shortfall", dir: "desc", page: 1 }
      : { q: "", type: "all", show: "all", tab: "trade", sort: "shortfall", dir: "desc", page: 1 },
  );

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
      <MrpToolbar view="requirements" date={cutoffDate} section={section} />

      {/* Header — title + inline item count / cutoff meta */}
      <PageHeader
        title={
          section === "make"
            ? "Make MRP — Requirements"
            : section === "trade"
              ? "Trade MRP — Requirements"
              : "MRP — Material Requirements"
        }
        meta={
          <>
            {sorted.length} of {tabRows.length} items in this tab
            {cutoffDate && ` — up to ${new Date(cutoffDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
          </>
        }
      />

      {/* Procurement Type Tabs — split MRP into procurement vs production
          planning views. Switching tabs scopes the table, summary cards
          and all downstream filters. Hidden when the page is already locked to
          one side via its sidebar section (Make MRP / Trade MRP). */}
      {!section && (
        <Tabs
          variant="underline"
          className="mb-4"
          value={procurementTab}
          onChange={(v) => { setProcurementTab(v as ProcurementTab); resetPage(); }}
          tabs={[
            { value: "trade", label: "Trade · To Procure", count: tabCounts.trade },
            { value: "make", label: "Make · To Manufacture", count: tabCounts.make },
            { value: "all", label: "All", count: tabCounts.all },
          ]}
        />
      )}

      {/* Summary stats — computed off the active-tab slice */}
      <StatStrip className="mb-3">
        <StatTile label="Total Items" value={totals.totalItems.toLocaleString()} />
        <StatTile label="Total Required" value={totals.totalRequired.toLocaleString()} />
        <StatTile label="Items with Shortfall" value={totals.itemsWithShortfall.toLocaleString()} tone="danger" />
        <StatTile label="Total Shortfall Units" value={totals.totalShortfall.toLocaleString()} tone="danger" />
      </StatStrip>

      {/* Filters Row */}
      <Toolbar>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search code, name, category..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-8"
          />
        </div>

        <Select
          size="sm"
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
          size="sm"
          value={shortfallFilter}
          onChange={(e) => { setShortfallFilter(e.target.value as ShortfallFilter); resetPage(); }}
          className="w-[160px]"
        >
          <option value="all">All Items</option>
          <option value="shortfall">Shortfall Only</option>
          <option value="excess">Sufficient Only</option>
        </Select>
      </Toolbar>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="card-surface overflow-hidden">
          <EmptyState
            icon={<Calculator size={28} />}
            title={
              initialData.length === 0
                ? "No material requirements found"
                : "No items match your filters"
            }
            description={
              initialData.length === 0
                ? "Ensure jobs have BOM lines with mapped items."
                : undefined
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <SortHeader label="Code" sortField="code" />
                <SortHeader label="Item Name" sortField="name" />
                <TableHead>Type</TableHead>
                <SortHeader label="Category" sortField="category" />
                <SortHeader label="Required" sortField="required" className="text-right" />
                <SortHeader label="In Stock" sortField="stock" className="text-right" />
                <SortHeader label="Shortfall" sortField="shortfall" className="text-right" />
                {showPo && <TableHead className="text-right" title="On order — outstanding purchase-order qty not yet received">On order</TableHead>}
                {showPo && <TableHead className="text-right" title="To buy — net still to procure after subtracting open POs">To buy</TableHead>}
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
                        <span className="text-[var(--destructive)]">
                          -{row.shortfall.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[var(--success)]">
                          +{excess.toLocaleString()}
                        </span>
                      )}
                    </TableCell>
                    {showPo && (
                      <TableCell className="text-right">
                        {row.on_order > 0 ? (
                          <span className="text-[var(--primary)] font-medium">{row.on_order.toLocaleString()}</span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </TableCell>
                    )}
                    {showPo && (
                      <TableCell className="text-right font-medium">
                        {row.shortfall === 0 ? (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        ) : row.to_buy > 0 ? (
                          <span className="text-[var(--destructive)]">{row.to_buy.toLocaleString()}</span>
                        ) : (
                          <Badge variant="blue" title="Shortfall is fully covered by an open PO">on order</Badge>
                        )}
                      </TableCell>
                    )}
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
