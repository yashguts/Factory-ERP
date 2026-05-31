"use client";

import { useState, useMemo, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { nextCodeInSeries } from "@/lib/inventory/next-code";
import type { ItemType, ItemCategory, UnitOfMeasurement, Warehouse } from "@/lib/supabase/types";

interface ItemWithStock {
  id: string;
  code: string;
  name: string;
  lookup_key: string | null;
  description: string | null;
  item_type: ItemType;
  category_id: string | null;
  uom_id: string;
  minimum_stock: number;
  reorder_point: number;
  lead_time_days: number;
  cost_price: number;
  is_active: boolean;
  stock_behaviour: "stocked" | "phantom" | "tooling";
  procurement_type: "make" | "trade" | null;
  category_procurement_type: "make" | "trade" | null;
  effective_procurement_type: "make" | "trade" | null;
  suppliers: string[];
  category: {
    id: string;
    name: string;
    procurement_type?: "make" | "trade" | null;
  } | null;
  uom: { id: string; abbreviation: string } | null;
  total_stock: number;
}

interface Props {
  initialItems: ItemWithStock[];
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

export function InventoryClient({ initialItems, categories, units, warehouses, initialEditItemId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "zero" | "in_stock">("all");
  const [behaviourFilter, setBehaviourFilter] = useState<"all" | "stocked" | "phantom" | "tooling">("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [showItemForm, setShowItemForm] = useState(false);
  const [showStockAdjust, setShowStockAdjust] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithStock | null>(null);
  // When set, the form opens in "clone" mode pre-filled from this source.
  const [cloneSource, setCloneSource] = useState<ItemWithStock | null>(null);

  // All existing codes — recomputed only when the items list changes,
  // so the "next code in series" lookup is O(N) once per render cycle.
  const allCodes = useMemo(
    () => initialItems.map((i) => i.code),
    [initialItems],
  );

  const handleClone = useCallback(
    (item: ItemWithStock) => {
      setSelectedItem(null); // make sure we're not in edit mode
      setCloneSource(item);
      setShowItemForm(true);
    },
    [],
  );

  // Deep-link from the Daily Changes page: `/inventory?edit=<id>` opens the
  // matching item's edit modal, then strips the param so a refresh/back
  // doesn't reopen it. Soft-deleted items aren't in the active list, so the
  // modal simply won't open for those (undo the delete first).
  useEffect(() => {
    if (!initialEditItemId) return;
    const target = initialItems.find((i) => i.id === initialEditItemId);
    if (target) {
      setSelectedItem(target);
      setCloneSource(null);
      setShowItemForm(true);
    }
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/inventory");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditItemId]);

  // Build category tree for filter (supports 3 levels: parent → child → grandchild)
  const categoryTree = useMemo(() => {
    const parents = categories.filter((c) => !c.parent_id);
    return parents.map((p) => {
      const directChildren = categories.filter((c) => c.parent_id === p.id);
      // Collect grandchildren (children of children)
      const grandchildren = directChildren.flatMap((child) =>
        categories.filter((c) => c.parent_id === child.id)
      );
      // Sub-categories = direct children + grandchildren (all descendants)
      const subCategories = [...directChildren, ...grandchildren];
      return { ...p, subCategories };
    });
  }, [categories]);

  // Build mapping: item_type → Set of parent category IDs that have items of that type
  const typeToParentCatIds = useMemo(() => {
    const catToParent: Record<string, string> = {};
    for (const cat of categories) {
      if (!cat.parent_id) catToParent[cat.id] = cat.id;
    }
    for (const cat of categories) {
      if (cat.parent_id && catToParent[cat.parent_id] !== undefined) {
        catToParent[cat.id] = cat.parent_id;
      }
    }
    for (const cat of categories) {
      if (cat.parent_id && catToParent[cat.id] === undefined && catToParent[cat.parent_id] !== undefined) {
        catToParent[cat.id] = catToParent[cat.parent_id];
      }
    }
    const map: Record<string, Set<string>> = {};
    for (const item of initialItems) {
      if (!item.category_id) continue;
      const parentId = catToParent[item.category_id];
      if (!parentId) continue;
      if (!map[item.item_type]) map[item.item_type] = new Set();
      map[item.item_type].add(parentId);
    }
    return map;
  }, [initialItems, categories]);

  // Filter category tree by selected type
  const filteredCategoryTree = useMemo(() => {
    if (typeFilter === "all") return categoryTree;
    const allowedIds = typeToParentCatIds[typeFilter];
    if (!allowedIds || allowedIds.size === 0) return [];
    return categoryTree.filter((c) => allowedIds.has(c.id));
  }, [typeFilter, typeToParentCatIds, categoryTree]);

  // Get sub-categories that belong to the selected parent
  const subCategoryOptions = useMemo(() => {
    if (categoryFilter === "all") return [];
    const parent = filteredCategoryTree.find((c) => c.id === categoryFilter);
    if (parent) return parent.subCategories;
    return [];
  }, [categoryFilter, filteredCategoryTree]);

  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");

  // Filter items
  // Multi-token fuzzy search: split the query on whitespace and require
  // every token to appear somewhere in name/lookup_key/code/description.
  // Order-independent — "rope wire 12mm" matches "Wire Rope 12mm".
  const searchTokens = useMemo(() => {
    return search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }, [search]);

  const filtered = useMemo(() => {
    return initialItems.filter((item) => {
      if (searchTokens.length > 0) {
        const haystack = [
          item.lookup_key,
          item.name,
          item.code,
          item.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        for (const token of searchTokens) {
          if (!haystack.includes(token)) return false;
        }
      }

      if (typeFilter !== "all" && item.item_type !== typeFilter) return false;

      if (behaviourFilter !== "all" && item.stock_behaviour !== behaviourFilter) return false;

      if (categoryFilter !== "all") {
        if (subCategoryFilter !== "all") {
          if (item.category_id !== subCategoryFilter) return false;
        } else {
          const parent = categoryTree.find((c) => c.id === categoryFilter);
          if (parent) {
            const validIds = new Set([parent.id, ...parent.subCategories.map((s) => s.id)]);
            if (!item.category_id || !validIds.has(item.category_id)) return false;
          }
        }
      }

      if (stockFilter === "low") {
        if (!(item.total_stock <= item.reorder_point && item.reorder_point > 0)) return false;
      } else if (stockFilter === "zero") {
        if (item.total_stock !== 0) return false;
      } else if (stockFilter === "in_stock") {
        if (item.total_stock <= 0) return false;
      }

      return true;
    });
  }, [initialItems, searchTokens, typeFilter, behaviourFilter, categoryFilter, subCategoryFilter, stockFilter, categoryTree]);

  // Sort items
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code":
          cmp = a.code.localeCompare(b.code);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "stock":
          cmp = a.total_stock - b.total_stock;
          break;
        case "category":
          cmp = (a.category?.name ?? "").localeCompare(b.category?.name ?? "");
          break;
        case "cost":
          cmp = a.cost_price - b.cost_price;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  const resetPage = () => setPage(1);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const refresh = () => startTransition(() => router.refresh());

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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {sorted.length} of {initialItems.length} items
            {isPending ? " — refreshing..." : ""}
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
          <Button onClick={() => { setSelectedItem(null); setCloneSource(null); setShowItemForm(true); }}>
            <Plus size={16} className="mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search name, code, or spec..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-9"
          />
        </div>

        {/* Type Filter */}
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

        {/* Category Filter */}
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

        {/* Sub-Category Filter (only shown when parent selected) */}
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

        {/* Stock Filter */}
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

        {/* Stock-behaviour filter */}
        <Select
          value={behaviourFilter}
          onChange={(e) => { setBehaviourFilter(e.target.value as typeof behaviourFilter); resetPage(); }}
          className="w-[150px]"
        >
          <option value="all">All Behaviour</option>
          <option value="stocked">Stocked</option>
          <option value="phantom">Phantom</option>
          <option value="tooling">Tooling</option>
        </Select>
      </div>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <Package size={48} className="mx-auto mb-4 text-[var(--muted-foreground)] opacity-50" />
          <p className="text-[var(--muted-foreground)]">
            {initialItems.length === 0
              ? "No items yet. Add your first item to get started."
              : "No items match your filters."}
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
                <TableHead>M/T</TableHead>
                <SortHeader label="Category" sortField="category" />
                <SortHeader label="Stock" sortField="stock" />
                <SortHeader label="Cost (₹)" sortField="cost" />
                <TableHead>Status</TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((item) => {
                const isLow = item.total_stock <= item.reorder_point && item.reorder_point > 0;
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-[var(--muted)]"
                    onClick={() => { setSelectedItem(item); setShowItemForm(true); }}
                  >
                    <TableCell className="font-mono text-xs">{item.code}</TableCell>
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
                        <Badge
                          variant="blue"
                          className="text-[10px] px-1.5"
                          title={
                            item.procurement_type
                              ? "Make (per-item override)"
                              : "Make (inherited from category)"
                          }
                        >
                          M
                        </Badge>
                      ) : item.effective_procurement_type === "trade" ? (
                        <Badge
                          variant="amber"
                          className="text-[10px] px-1.5"
                          title={
                            item.procurement_type
                              ? "Trade (per-item override)"
                              : "Trade (inherited from category)"
                          }
                        >
                          T
                        </Badge>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{item.category?.name ?? "-"}</TableCell>
                    <TableCell className="text-right font-medium">
                      <span className={isLow ? "text-[var(--destructive)]" : ""}>
                        {Number(item.total_stock).toLocaleString()}
                      </span>{" "}
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {item.uom?.abbreviation}
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
                        item={item}
                        warehouses={warehouses}
                        onSuccess={refresh}
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
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="text-sm font-medium">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
            >
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
          suggestedCode={
            cloneSource ? nextCodeInSeries(cloneSource.code, allCodes) : null
          }
          categories={categories}
          units={units}
          items={initialItems}
          onClose={() => {
            setShowItemForm(false);
            setCloneSource(null);
          }}
          onSaved={() => {
            refresh();
            setCloneSource(null);
          }}
        />
      )}
      {showStockAdjust && (
        <StockAdjustModal
          items={initialItems}
          warehouses={warehouses}
          onClose={() => setShowStockAdjust(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
