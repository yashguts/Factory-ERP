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
import { Plus, Search, Package, ChevronLeft, ChevronRight, ArrowUpDown, Copy, History } from "lucide-react";
import { ItemFormModal } from "@/components/inventory/item-form-modal";
import { StockAdjustModal } from "@/components/inventory/stock-adjust-modal";
import { InlineStockAdjust } from "@/components/inventory/inline-stock-adjust";
import {
  getInventoryPage,
  getItemForEdit,
  suggestNextCode,
  type InventoryRow,
  type InventoryTabCounts,
  type ItemWithStock,
  type TypeCatFacet,
} from "@/lib/actions/inventory";
import type { ItemType, ItemCategory, UnitOfMeasurement, Warehouse } from "@/lib/supabase/types";
import { useRealtimeRefresh } from "@/lib/realtime/use-realtime-refresh";

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
};

const TYPE_BADGE_VARIANT: Record<ItemType, "blue" | "purple" | "green" | "amber" | "pink"> = {
  raw_material: "blue",
  sub_assembly: "purple",
  finished_good: "green",
  mechanical_finished_stock: "amber",
  door_panel: "pink",
};

type SortKey = "code" | "name" | "stock" | "category" | "cost";
type SortDir = "asc" | "desc";

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
    () => readParam(sp, "type", "all", ["all", "raw_material", "sub_assembly", "finished_good", "mechanical_finished_stock", "door_panel"]) as ItemType | "all",
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {total.toLocaleString()} items{isPending ? " — loading..." : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/changes">
            <Button variant="secondary" title="See what changed on a given day">
              <History size={16} className="mr-2" />
              Daily Changes
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => setShowStockAdjust(true)}>
            Stock Adjustment
          </Button>
          <Button onClick={() => { setSelectedItem(null); setCloneSource(null); setSuggestedCode(null); setShowItemForm(true); }}>
            <Plus size={16} className="mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Make / Trade tabs — same pattern as the MRP page so the split reads
          the same everywhere. Counts are the global universe, not the current
          filter result (mirrors MRP). */}
      <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
        {([
          { key: "all", label: "All", count: tabCounts.all },
          { key: "make", label: "Make · Manufactured", count: tabCounts.make },
          { key: "trade", label: "Trade · Purchased", count: tabCounts.trade },
        ] as const).map((t) => {
          const active = mtTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setMtTab(t.key); resetPage(); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                active
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
              <span className={`ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded-full ${
                active
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              }`}>
                {t.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search name, code, or spec..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-9"
          />
        </div>

        <Select
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
        </Select>

        <Select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setSubCategoryFilter("all"); resetPage(); }}
          className="w-[160px]"
        >
          <option value="all">All Categories</option>
          {filteredCategoryTree.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </Select>

        {subCategoryOptions.length > 0 && (
          <Select
            value={subCategoryFilter}
            onChange={(e) => { setSubCategoryFilter(e.target.value); resetPage(); }}
            className="w-[220px]"
          >
            <option value="all">All Sub-categories</option>
            {subCategoryOptions.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </Select>
        )}

        <Select
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
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <Package size={48} className="mx-auto mb-4 text-[var(--muted-foreground)] opacity-50" />
          <p className="text-[var(--muted-foreground)]">
            {total === 0 && !isPending
              ? "No items match your filters."
              : "Loading..."}
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table>
            <TableHeader>
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
                <SortHeader label="Category" sortField="category" />
                <SortHeader label="Stock" sortField="stock" />
                <SortHeader label="Cost (₹)" sortField="cost" />
                <TableHead>Status</TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-10"></TableHead>
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
                      <div className="font-medium">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-[var(--muted-foreground)] truncate max-w-[300px]">
                          {item.description}
                        </div>
                      )}
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
                    <TableCell>
                      {item.demand_source === "jobs" ? (
                        <Badge variant="blue" className="text-[10px] px-1.5" title="Direct demand — pickable on the job form's BOM sections, or already on a job BOM">
                          Jobs
                        </Badge>
                      ) : item.demand_source === "formula" ? (
                        <Badge variant="purple" className="text-[10px] px-1.5" title="Dependent demand — consumed by a program or listed in an item's parts list">
                          Formula
                        </Badge>
                      ) : item.demand_source === "none" ? (
                        <Badge variant="amber" className="text-[10px] px-1.5" title="No demand link — nothing generates a requirement for this item yet. Give it a parts-list/program link on its item page, or set a minimum stock.">
                          No link
                        </Badge>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]" title="Tooling — not planned, by design">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{item.category_name ?? "-"}</TableCell>
                    <TableCell className="text-right font-medium">
                      <span className={isLow ? "text-[var(--destructive)]" : ""}>
                        {Number(item.total_stock).toLocaleString()}
                      </span>{" "}
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
                    <TableCell className="w-8 px-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleClone(item)}
                        title="Clone this item — pre-fills a new item with the same category, UOM, Make/Trade and suppliers"
                        className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                    <TableCell className="w-10 px-1" onClick={(e) => e.stopPropagation()}>
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
