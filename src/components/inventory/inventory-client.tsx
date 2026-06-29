"use client";

import { useState, useMemo, useTransition, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  readParam,
  readIntParam,
  hasNoListParams,
  useUrlListSync,
} from "@/lib/hooks/use-url-list-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Plus, Search, Package, ChevronLeft, ChevronRight, ArrowUpDown, Copy, History, FileText, FileSpreadsheet, Loader2, Map } from "lucide-react";
import { ItemFormModal } from "@/components/inventory/item-form-modal";
import { StockAdjustModal } from "@/components/inventory/stock-adjust-modal";
import { InlineStockAdjust } from "@/components/inventory/inline-stock-adjust";
import { ProgramsPopover } from "@/components/inventory/programs-popover";
import { StockLedgerPopover } from "@/components/inventory/stock-ledger-popover";
import {
  getInventoryPage,
  getInventoryForExport,
  getItemForEdit,
  suggestNextCode,
  setItemDemandOverride,
  type InventoryQuery,
  type InventoryRow,
  type InventoryTabCounts,
  type ItemWithStock,
  type TypeCatFacet,
} from "@/lib/actions/inventory";
import { exportRowsToXlsx } from "@/lib/export/xlsx";
import { downloadInventoryPdf } from "@/lib/export/inventory-pdf";
import { INVENTORY_EXPORT_COLUMNS } from "@/lib/export/inventory-export";
import type { ItemType, ItemCategory, UnitOfMeasurement, Warehouse, DemandOverride } from "@/lib/supabase/types";
import { useRealtimeRefresh } from "@/lib/realtime/use-realtime-refresh";
import { useToast } from "@/components/ui/toast";

interface Props {
  /** First page of rows, rendered server-side for instant paint. */
  initialRows: InventoryRow[];
  /** Total count matching the default (unfiltered) query. */
  initialTotal: number;
  /** Global Make / Trade / All counts for the tab bar (not filter-reactive). */
  tabCounts: InventoryTabCounts;
  /** Distinct (item_type, category_id) pairs, for scoping the category dropdowns. */
  facets: TypeCatFacet[];
  categories: (ItemCategory & {
    procurement_type?: "make" | "trade" | null;
  })[];
  units: UnitOfMeasurement[];
  warehouses: Warehouse[];
  /** When set (via `/inventory?edit=<id>`), auto-open that item's edit modal. */
  initialEditItemId?: string | null;
}

const TYPE_LABELS: Record<ItemType, string> = {
  raw_material: "Raw Material",
  sub_assembly: "Sub Assembly",
  finished_good: "Finished Good",
  mechanical_finished_stock: "Mech. Finished Stock",
  door_panel: "Door Panel",
  temporary: "Temporary",
};

const TYPE_BADGE_VARIANT: Record<ItemType, "blue" | "purple" | "green" | "amber" | "pink" | "neutral"> = {
  raw_material: "blue",
  sub_assembly: "purple",
  finished_good: "green",
  mechanical_finished_stock: "amber",
  door_panel: "pink",
  temporary: "neutral",
};

type SortKey = "code" | "name" | "stock" | "category" | "cost";
type SortDir = "asc" | "desc";

/** Menu options for the inline Demand Flow Type editor (null = automatic). */
const DEMAND_CHOICES: { value: DemandOverride | null; label: string; hint: string }[] = [
  { value: null, label: "Auto (computed)", hint: "Classify from job-form categories, job BOMs, programs and parts lists" },
  { value: "jobs", label: "Jobs (direct)", hint: "Job orders capture this item directly" },
  { value: "formula", label: "Formula", hint: "A program or parts list derives its requirement" },
  { value: "none", label: "No link", hint: "Nothing generates a requirement for it" },
];

const PAGE_SIZE = 50;

const LIST_PARAM_KEYS = [
  "q", "type", "cat", "sub", "stock", "behav", "mt", "demand", "sort", "dir", "page",
] as const;

export function InventoryClient({ initialRows, initialTotal, tabCounts, facets, categories, units, warehouses, initialEditItemId }: Props) {
  const [isPending, startTransition] = useTransition();

  // Query state (drives the server fetch). Initialised from the URL so Back /
  // reload / shared links land on the exact same view (see use-url-list-state).
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [debouncedSearch, setDebouncedSearch] = useState(() => readParam(sp, "q", ""));
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">(
    () => readParam(sp, "type", "all", ["all", "raw_material", "sub_assembly", "finished_good", "mechanical_finished_stock", "door_panel", "temporary"]) as ItemType | "all",
  );
  const [categoryFilter, setCategoryFilter] = useState<string>(() => readParam(sp, "cat", "all"));
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>(() => readParam(sp, "sub", "all"));
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "zero" | "in_stock">(
    () => readParam(sp, "stock", "all", ["all", "low", "zero", "in_stock"]) as "all" | "low" | "zero" | "in_stock",
  );
  const [behaviourFilter, setBehaviourFilter] = useState<"all" | "stocked" | "phantom" | "tooling">(
    () => readParam(sp, "behav", "all", ["all", "stocked", "phantom", "tooling"]) as "all" | "stocked" | "phantom" | "tooling",
  );
  const [mtTab, setMtTab] = useState<"all" | "make" | "trade">(
    () => readParam(sp, "mt", "all", ["all", "make", "trade"]) as "all" | "make" | "trade",
  );
  const [demandFilter, setDemandFilter] = useState<"all" | "jobs" | "formula" | "none">(
    () => readParam(sp, "demand", "all", ["all", "jobs", "formula", "none"]) as "all" | "jobs" | "formula" | "none",
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "code", ["code", "name", "stock", "category", "cost"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "asc", ["asc", "desc"]) as SortDir,
  );
  const [page, setPage] = useState(() => readIntParam(sp, "page", 1));

  // Mirror the state into the URL (shallow — no server round trip).
  useUrlListSync(
    { q: debouncedSearch, type: typeFilter, cat: categoryFilter, sub: subCategoryFilter, stock: stockFilter, behav: behaviourFilter, mt: mtTab, demand: demandFilter, sort: sortKey, dir: sortDir, page },
    { q: "", type: "all", cat: "all", sub: "all", stock: "all", behav: "all", mt: "all", demand: "all", sort: "code", dir: "asc", page: 1 },
  );

  // Server-provided page data.
  const [rows, setRows] = useState<InventoryRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);

  // Modal state.
  const [showItemForm, setShowItemForm] = useState(false);
  const [showStockAdjust, setShowStockAdjust] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithStock | null>(null);
  const [cloneSource, setCloneSource] = useState<ItemWithStock | null>(null);
  const [suggestedCode, setSuggestedCode] = useState<string | null>(null);

  // Inline Demand Flow Type editor: which row's menu is open.
  const [demandMenuFor, setDemandMenuFor] = useState<string | null>(null);
  // Which export is in flight (it fetches the full filtered set, not just the page).
  const [exporting, setExporting] = useState<null | "pdf" | "excel">(null);
  const toast = useToast();

  const resetPage = () => setPage(1);

  // Debounce the search box → debouncedSearch (which the fetch watches).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch a page from the server for the current query. Stable per query state,
  // so it doubles as the "reload after a mutation" function. A monotonic request
  // id guards against a slow earlier response overwriting a newer one when the
  // user changes filters/search/page quickly.
  const reqId = useRef(0);
  const runQuery = useCallback(() => {
    const myId = ++reqId.current;
    startTransition(async () => {
      const res = await getInventoryPage({
        search: debouncedSearch,
        type: typeFilter,
        category: categoryFilter,
        sub: subCategoryFilter,
        stock: stockFilter,
        behaviour: behaviourFilter,
        procurement: mtTab,
        demand: demandFilter,
        sort: sortKey,
        dir: sortDir,
        page,
        pageSize: PAGE_SIZE,
      });
      if (myId !== reqId.current) return; // a newer query superseded this one
      // Ran off the end (e.g. the last row on this page was just deleted, or a
      // shrinking filter) — total_count rides on rows, so an empty page would
      // otherwise read as "0 items". Snap back to page 1 (re-fetches via effect).
      if (res.rows.length === 0 && page > 1) {
        setPage(1);
        return;
      }
      setRows(res.rows);
      setTotal(res.total);
    });
  }, [debouncedSearch, typeFilter, categoryFilter, subCategoryFilter, stockFilter, behaviourFilter, mtTab, demandFilter, sortKey, sortDir, page]);

  // Re-fetch when the query changes — but skip the very first run when the
  // view opened with default state, since initialRows already match the
  // default query (instant paint, no flash). When the URL carried filters
  // (Back navigation / shared link), fetch immediately so rows match them.
  const firstRun = useRef(hasNoListParams(sp, LIST_PARAM_KEYS));
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    runQuery();
  }, [runQuery]);

  // Live sync across users: re-fetch the current page when items/stock change.
  useRealtimeRefresh(["items", "inventory"], runQuery);

  // Deep-link from Daily Changes: `/inventory?edit=<id>` opens that item's edit
  // modal, then strips the param. Soft-deleted items return null → no open.
  useEffect(() => {
    if (!initialEditItemId) return;
    startTransition(async () => {
      const full = await getItemForEdit(initialEditItemId);
      if (full) {
        setSelectedItem(full);
        setCloneSource(null);
        setSuggestedCode(null);
        setShowItemForm(true);
      }
    });
    if (typeof window !== "undefined") {
      // Strip only the edit param — keep any list filters in the URL.
      const params = new URLSearchParams(window.location.search);
      params.delete("edit");
      const qs = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        qs ? `/inventory?${qs}` : "/inventory",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditItemId]);

  // Category tree for the filter (parent → all descendants), from the category list.
  const categoryTree = useMemo(() => {
    const parents = categories.filter((c) => !c.parent_id);
    return parents.map((p) => {
      const directChildren = categories.filter((c) => c.parent_id === p.id);
      const grandchildren = directChildren.flatMap((child) =>
        categories.filter((c) => c.parent_id === child.id),
      );
      return { ...p, subCategories: [...directChildren, ...grandchildren] };
    });
  }, [categories]);

  // item_type → Set of parent category IDs that contain items of that type,
  // derived from the (small) facet pairs instead of the full item list.
  const typeToParentCatIds = useMemo(() => {
    const catToParent: Record<string, string> = {};
    for (const cat of categories) if (!cat.parent_id) catToParent[cat.id] = cat.id;
    for (const cat of categories)
      if (cat.parent_id && catToParent[cat.parent_id] !== undefined) catToParent[cat.id] = cat.parent_id;
    for (const cat of categories)
      if (cat.parent_id && catToParent[cat.id] === undefined && catToParent[cat.parent_id] !== undefined)
        catToParent[cat.id] = catToParent[cat.parent_id];

    const map: Record<string, Set<string>> = {};
    for (const f of facets) {
      if (!f.category_id) continue;
      const parentId = catToParent[f.category_id];
      if (!parentId) continue;
      if (!map[f.item_type]) map[f.item_type] = new Set();
      map[f.item_type].add(parentId);
    }
    return map;
  }, [facets, categories]);

  const filteredCategoryTree = useMemo(() => {
    if (typeFilter === "all") return categoryTree;
    const allowedIds = typeToParentCatIds[typeFilter];
    if (!allowedIds || allowedIds.size === 0) return [];
    return categoryTree.filter((c) => allowedIds.has(c.id));
  }, [typeFilter, typeToParentCatIds, categoryTree]);

  const subCategoryOptions = useMemo(() => {
    if (categoryFilter === "all") return [];
    const parent = filteredCategoryTree.find((c) => c.id === categoryFilter);
    return parent ? parent.subCategories : [];
  }, [categoryFilter, filteredCategoryTree]);

  // The Sub-category dropdown is always shown (for discoverability) but disabled
  // until a category with children is selected. The placeholder explains why.
  const subCatDisabled = categoryFilter === "all" || subCategoryOptions.length === 0;
  const subCatPlaceholder =
    categoryFilter === "all"
      ? "Sub-category — pick a category"
      : subCategoryOptions.length === 0
        ? "No sub-categories"
        : "All Sub-categories";

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    resetPage();
  };

  // Open the edit/clone modal — the row is lightweight, so fetch the full item.
  const openEdit = (id: string) => {
    startTransition(async () => {
      const full = await getItemForEdit(id);
      if (full) {
        setCloneSource(null);
        setSuggestedCode(null);
        setSelectedItem(full);
        setShowItemForm(true);
      }
    });
  };

  const handleClone = (row: InventoryRow) => {
    startTransition(async () => {
      const [full, next] = await Promise.all([
        getItemForEdit(row.id),
        suggestNextCode(row.code),
      ]);
      if (full) {
        setSelectedItem(null);
        setCloneSource(full);
        setSuggestedCode(next);
        setShowItemForm(true);
      }
    });
  };

  // Save a manual Demand Flow Type mark (or null = back to automatic), then
  // refresh the page so the badge/filter reflect the effective value.
  const applyDemandOverride = (item: InventoryRow, value: DemandOverride | null) => {
    setDemandMenuFor(null);
    startTransition(async () => {
      const res = await setItemDemandOverride(item.id, value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        value
          ? `${item.code} marked "${DEMAND_CHOICES.find((c) => c.value === value)?.label}"`
          : `${item.code} is back to automatic classification`,
      );
      runQuery();
    });
  };

  // ----- Export (Excel / PDF) ------------------------------------------------
  // Query for the CURRENT filters with no pagination — the export covers the
  // whole filtered set, in the on-screen sort order (not just the visible page).
  const exportQuery = (): InventoryQuery => ({
    search: debouncedSearch,
    type: typeFilter,
    category: categoryFilter,
    sub: subCategoryFilter,
    stock: stockFilter,
    behaviour: behaviourFilter,
    procurement: mtTab,
    demand: demandFilter,
    sort: sortKey,
    dir: sortDir,
  });

  const exportScope = mtTab === "make" ? "Make" : mtTab === "trade" ? "Trade" : "All";

  // One-line summary of the active filters, printed in the PDF header.
  const filtersSummary = (): string => {
    const parts: string[] = [];
    if (debouncedSearch.trim()) parts.push(`Search: "${debouncedSearch.trim()}"`);
    if (typeFilter !== "all") parts.push(`Type: ${TYPE_LABELS[typeFilter]}`);
    if (categoryFilter !== "all") {
      const cat = categories.find((c) => c.id === categoryFilter);
      if (cat) parts.push(`Category: ${cat.name}`);
    }
    if (subCategoryFilter !== "all") {
      const sub = categories.find((c) => c.id === subCategoryFilter);
      if (sub) parts.push(sub.name);
    }
    if (stockFilter !== "all") {
      parts.push({ low: "Low Stock", zero: "Zero Stock", in_stock: "In Stock" }[stockFilter]);
    }
    if (behaviourFilter !== "all") {
      parts.push({ stocked: "Stocked", phantom: "Loose (phantom)", tooling: "Tooling" }[behaviourFilter]);
    }
    if (demandFilter !== "all") {
      parts.push(`Demand: ${{ jobs: "Jobs", formula: "Formula", none: "No link" }[demandFilter]}`);
    }
    return parts.join(" · ");
  };

  const handleExport = async (fmt: "pdf" | "excel") => {
    if (exporting) return;
    setExporting(fmt);
    try {
      const all = await getInventoryForExport(exportQuery());
      if (all.length === 0) {
        toast.error("Nothing to export for the current filters.");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `Inventory_${exportScope}_${stamp}`;
      if (fmt === "excel") {
        exportRowsToXlsx({ rows: all, columns: INVENTORY_EXPORT_COLUMNS, filename, sheetName: "Inventory" });
      } else {
        await downloadInventoryPdf(all, { scope: exportScope, filtersSummary: filtersSummary(), filename });
      }
      toast.success(`Exported ${all.length.toLocaleString()} items to ${fmt === "excel" ? "Excel" : "PDF"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(null);
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

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Inventory"
        icon={<Package size={18} />}
        meta={`${total.toLocaleString()} items${isPending ? " — loading..." : ""}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExport("pdf")}
              disabled={!!exporting || total === 0}
              title="Download the current filtered list as PDF"
            >
              {exporting === "pdf" ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <FileText size={16} className="mr-2" />
              )}
              PDF
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExport("excel")}
              disabled={!!exporting || total === 0}
              title="Download the current filtered list as Excel"
            >
              {exporting === "excel" ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <FileSpreadsheet size={16} className="mr-2" />
              )}
              Excel
            </Button>
            <Link href="/inventory/print">
              <Button variant="secondary" size="sm" title="Visual category map with R1 packing list coverage">
                <Map size={16} className="mr-2" />
                Atlas
              </Button>
            </Link>
            <Link href="/inventory/changes">
              <Button variant="secondary" size="sm" title="See what changed on a given day">
                <History size={16} className="mr-2" />
                Daily Changes
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={() => setShowStockAdjust(true)}>
              Stock Adjustment
            </Button>
            <Button size="sm" onClick={() => { setSelectedItem(null); setCloneSource(null); setSuggestedCode(null); setShowItemForm(true); }}>
              <Plus size={16} className="mr-2" />
              Add Item
            </Button>
          </>
        }
      />

      {/* Make / Trade tabs + filters in one toolbar band. Tab counts are the
          global universe, not the current filter result (mirrors MRP). */}
      <Toolbar className="mb-2">
        <Tabs
          variant="underline"
          value={mtTab}
          onChange={(v) => { setMtTab(v as "all" | "make" | "trade"); resetPage(); }}
          tabs={[
            { value: "all", label: "All", count: tabCounts.all },
            { value: "make", label: "Make", count: tabCounts.make },
            { value: "trade", label: "Trade", count: tabCounts.trade },
          ]}
        />

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search name, code, or spec..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-9"
          />
        </div>

        <Select
          size="sm"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value as ItemType | "all"); setCategoryFilter("all"); setSubCategoryFilter("all"); resetPage(); }}
          className="w-[150px]"
        >
          <option value="all">All Types</option>
          <option value="raw_material">Raw Material</option>
          <option value="sub_assembly">Sub Assembly</option>
          <option value="finished_good">Finished Good</option>
          <option value="mechanical_finished_stock">Mech. Finished Stock</option>
          <option value="door_panel">Door Panel</option>
          <option value="temporary">Temporary</option>
        </Select>

        <Select
          size="sm"
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setSubCategoryFilter("all"); resetPage(); }}
          className="w-[160px]"
        >
          <option value="all">All Categories</option>
          {filteredCategoryTree.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </Select>

        <Select
          size="sm"
          value={subCategoryFilter}
          onChange={(e) => { setSubCategoryFilter(e.target.value); resetPage(); }}
          className="w-[220px]"
          disabled={subCatDisabled}
          title={
            categoryFilter === "all"
              ? "Select a category first to filter by sub-category"
              : subCategoryOptions.length === 0
                ? "This category has no sub-categories"
                : "Filter by sub-category"
          }
        >
          <option value="all">{subCatPlaceholder}</option>
          {subCategoryOptions.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </Select>

        <Select
          size="sm"
          value={stockFilter}
          onChange={(e) => { setStockFilter(e.target.value as typeof stockFilter); resetPage(); }}
          className="w-[140px]"
        >
          <option value="all">All Stock</option>
          <option value="in_stock">In Stock</option>
          <option value="low">Low Stock</option>
          <option value="zero">Zero Stock</option>
        </Select>

        <Select
          size="sm"
          value={behaviourFilter}
          onChange={(e) => { setBehaviourFilter(e.target.value as typeof behaviourFilter); resetPage(); }}
          className="w-[150px]"
        >
          <option value="all">All (excl. loose)</option>
          <option value="stocked">Stocked</option>
          <option value="phantom">Loose (phantom)</option>
          <option value="tooling">Tooling</option>
        </Select>

        <Select
          size="sm"
          value={demandFilter}
          onChange={(e) => { setDemandFilter(e.target.value as typeof demandFilter); resetPage(); }}
          className="w-[170px]"
          title="How the item gets its material requirement"
        >
          <option value="all">All Demand</option>
          <option value="jobs">Jobs (direct)</option>
          <option value="formula">Formula (program/parts)</option>
          <option value="none">No link</option>
        </Select>
      </Toolbar>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card-surface">
          {total === 0 && !isPending ? (
            <EmptyState
              icon={<Package size={28} />}
              title="No items match your filters"
              description="Try clearing the search or adjusting the filters above."
            />
          ) : (
            <EmptyState icon={<Package size={28} />} title="Loading..." />
          )}
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <SortHeader label="Code" sortField="code" />
                <SortHeader label="Name" sortField="name" />
                <TableHead>Type</TableHead>
                <TableHead title="M = Make (manufactured in-house) · T = Trade (purchased from suppliers)">
                  M/T
                </TableHead>
                <TableHead title="How the item gets its requirement: Jobs = picked on job BOMs · Formula = consumed by a program or parts list · No link = in no plan yet">
                  Demand
                </TableHead>
                <TableHead className="text-center" title="Active programs (operations) that produce or consume this item — hover the count for the program numbers">
                  Programs
                </TableHead>
                <SortHeader label="Category" sortField="category" />
                <SortHeader label="Stock" sortField="stock" />
                <SortHeader label="Cost (₹)" sortField="cost" />
                <TableHead>Status</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const isLow = item.total_stock <= item.reorder_point && item.reorder_point > 0;
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-[var(--muted)]"
                    onClick={() => openEdit(item.id)}
                  >
                    <TableCell className="font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                      <Link
                        href={`/inventory/${item.id}`}
                        className="text-[var(--primary)] hover:underline"
                        title="Open item — structure, parts list, programs"
                      >
                        {item.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-medium"
                        title={item.description ?? undefined}
                      >
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <Badge variant={TYPE_BADGE_VARIANT[item.item_type]}>
                          {TYPE_LABELS[item.item_type]}
                        </Badge>
                        {item.stock_behaviour === "phantom" && (
                          <Badge variant="purple" className="text-[10px] px-1.5" title="Phantom — made but never stocked">
                            Phantom
                          </Badge>
                        )}
                        {item.stock_behaviour === "tooling" && (
                          <Badge variant="neutral" className="text-[10px] px-1.5" title="Tooling — jig/template, not a product">
                            Tooling
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.effective_procurement_type === "make" ? (
                        <Badge variant="blue" className="text-[10px] px-1.5" title="Make">M</Badge>
                      ) : item.effective_procurement_type === "trade" ? (
                        <Badge variant="amber" className="text-[10px] px-1.5" title="Trade">T</Badge>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setDemandMenuFor(demandMenuFor === item.id ? null : item.id)}
                        className="cursor-pointer"
                        title={
                          (item.demand_overridden ? "Marked manually — " : "") +
                          (item.demand_source === "jobs"
                            ? "Direct demand — pickable on the job form's BOM sections, or already on a job BOM."
                            : item.demand_source === "formula"
                              ? "Dependent demand — consumed by a program or listed in an item's parts list."
                              : item.demand_source === "none"
                                ? "No demand link — nothing generates a requirement for this item yet."
                                : "Tooling — not planned, by design.") +
                          " Click to change."
                        }
                      >
                        {item.demand_source === "jobs" ? (
                          <Badge variant="blue" className={`text-[10px] px-1.5 ${item.demand_overridden ? "border-dashed" : ""}`}>
                            Jobs{item.demand_overridden ? " ✎" : ""}
                          </Badge>
                        ) : item.demand_source === "formula" ? (
                          <Badge variant="purple" className={`text-[10px] px-1.5 ${item.demand_overridden ? "border-dashed" : ""}`}>
                            Formula{item.demand_overridden ? " ✎" : ""}
                          </Badge>
                        ) : item.demand_source === "none" ? (
                          <Badge variant="amber" className={`text-[10px] px-1.5 ${item.demand_overridden ? "border-dashed" : ""}`}>
                            No link{item.demand_overridden ? " ✎" : ""}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </button>
                      {demandMenuFor === item.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setDemandMenuFor(null)} />
                          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg py-1">
                            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                              Demand flow type
                            </p>
                            {DEMAND_CHOICES.map((choice) => {
                              const isCurrent = item.demand_overridden
                                ? choice.value === item.demand_source
                                : choice.value === null;
                              return (
                                <button
                                  key={choice.label}
                                  type="button"
                                  onClick={() => applyDemandOverride(item, choice.value)}
                                  title={choice.hint}
                                  className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer hover:bg-[var(--muted)] ${
                                    isCurrent ? "font-semibold text-[var(--primary)]" : ""
                                  }`}
                                >
                                  {choice.label}
                                  {isCurrent ? " ✓" : ""}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      {item.programs.length > 0 ? (
                        <ProgramsPopover programs={item.programs}>
                          <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)] tabular-nums text-sm">
                            {item.programs.length}
                          </span>
                        </ProgramsPopover>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{item.category_name ?? "-"}</TableCell>
                    <TableCell className="text-right font-medium" onClick={(e) => e.stopPropagation()}>
                      <StockLedgerPopover itemId={item.id}>
                        <span
                          className={`cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)] ${isLow ? "text-[var(--destructive)]" : ""}`}
                        >
                          {Number(item.total_stock).toLocaleString()}
                        </span>
                      </StockLedgerPopover>{" "}
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {item.uom_abbreviation}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {item.cost_price > 0 ? `₹${Number(item.cost_price).toLocaleString("en-IN")}` : "-"}
                    </TableCell>
                    <TableCell>
                      {isLow ? (
                        <Badge variant="warning">Low</Badge>
                      ) : item.total_stock === 0 ? (
                        <Badge variant="danger">Out</Badge>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell className="w-16 px-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleClone(item)}
                          title="Clone this item — pre-fills a new item with the same category, UOM, Make/Trade and suppliers"
                          className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <InlineStockAdjust
                          item={{
                            id: item.id,
                            code: item.code,
                            name: item.name,
                            lookup_key: null,
                            uom: item.uom_abbreviation ? { id: "", abbreviation: item.uom_abbreviation } : null,
                          }}
                          warehouses={warehouses}
                          onSuccess={runQuery}
                        />
                      </div>
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
        <div className="flex items-center justify-between mt-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-sm font-medium">{page} / {totalPages}</span>
            <Button variant="secondary" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showItemForm && (
        <ItemFormModal
          item={selectedItem}
          cloneSource={cloneSource}
          suggestedCode={suggestedCode}
          categories={categories}
          units={units}
          items={facets}
          onClose={() => {
            setShowItemForm(false);
            setCloneSource(null);
            setSuggestedCode(null);
          }}
          onSaved={() => {
            runQuery();
            setCloneSource(null);
            setSuggestedCode(null);
          }}
        />
      )}
      {showStockAdjust && (
        <StockAdjustModal
          warehouses={warehouses}
          onClose={() => setShowStockAdjust(false)}
          onSaved={runQuery}
        />
      )}
    </div>
  );
}
