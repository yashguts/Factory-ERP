"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Plus, Search, Package, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { ItemFormModal } from "@/components/inventory/item-form-modal";
import { StockAdjustModal } from "@/components/inventory/stock-adjust-modal";
import type { ItemType, ItemCategory, UnitOfMeasurement, Warehouse } from "@/lib/supabase/types";

interface ItemWithStock {
  id: string;
  code: string;
  name: string;
  description: string | null;
  item_type: ItemType;
  category_id: string | null;
  uom_id: string;
  minimum_stock: number;
  reorder_point: number;
  lead_time_days: number;
  cost_price: number;
  is_active: boolean;
  category: { id: string; name: string } | null;
  uom: { id: string; abbreviation: string } | null;
  total_stock: number;
}

interface Props {
  initialItems: ItemWithStock[];
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  warehouses: Warehouse[];
}

const TYPE_LABELS: Record<ItemType, string> = {
  raw_material: "Raw Material",
  sub_assembly: "Sub Assembly",
  finished_good: "Finished Good",
  mechanical_finished_stock: "Mech. Finished Stock",
};

const TYPE_COLORS: Record<ItemType, string> = {
  raw_material: "bg-blue-100 text-blue-800",
  sub_assembly: "bg-purple-100 text-purple-800",
  finished_good: "bg-green-100 text-green-800",
  mechanical_finished_stock: "bg-amber-100 text-amber-800",
};

type SortKey = "code" | "name" | "stock" | "category" | "cost";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

export function InventoryClient({ initialItems, categories, units, warehouses }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "zero" | "in_stock">("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [showItemForm, setShowItemForm] = useState(false);
  const [showStockAdjust, setShowStockAdjust] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithStock | null>(null);

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

  // Get sub-categories that belong to the selected parent
  const subCategoryOptions = useMemo(() => {
    if (categoryFilter === "all") return [];
    const parent = categoryTree.find((c) => c.id === categoryFilter);
    if (parent) return parent.subCategories;
    return [];
  }, [categoryFilter, categoryTree]);

  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");

  // Filter items
  const filtered = useMemo(() => {
    return initialItems.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesSearch =
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          (item.description?.toLowerCase().includes(q) ?? false);
        if (!matchesSearch) return false;
      }

      if (typeFilter !== "all" && item.item_type !== typeFilter) return false;

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
  }, [initialItems, search, typeFilter, categoryFilter, subCategoryFilter, stockFilter, categoryTree]);

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
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {sorted.length} of {initialItems.length} items
            {isPending ? " — refreshing..." : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowStockAdjust(true)}>
            Stock Adjustment
          </Button>
          <Button onClick={() => { setSelectedItem(null); setShowItemForm(true); }}>
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
          onChange={(e) => { setTypeFilter(e.target.value as ItemType | "all"); resetPage(); }}
          className="w-[150px]"
        >
          <option value="all">All Types</option>
          <option value="raw_material">Raw Material</option>
          <option value="sub_assembly">Sub Assembly</option>
          <option value="finished_good">Finished Good</option>
          <option value="mechanical_finished_stock">Mech. Finished Stock</option>
        </Select>

        {/* Category Filter */}
        <Select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setSubCategoryFilter("all"); resetPage(); }}
          className="w-[160px]"
        >
          <option value="all">All Categories</option>
          {categoryTree.map((cat) => (
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
      </div>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="border border-[var(--border)] rounded-lg p-12 text-center">
          <Package size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)]">
            {initialItems.length === 0
              ? "No items yet. Add your first item to get started."
              : "No items match your filters."}
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Code" sortField="code" />
                <SortHeader label="Name" sortField="name" />
                <TableHead>Type</TableHead>
                <SortHeader label="Category" sortField="category" />
                <SortHeader label="Stock" sortField="stock" />
                <SortHeader label="Cost (₹)" sortField="cost" />
                <TableHead>Status</TableHead>
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
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[item.item_type]}`}>
                        {TYPE_LABELS[item.item_type]}
                      </span>
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          Low
                        </span>
                      ) : item.total_stock === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                          Out
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                          OK
                        </span>
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
          categories={categories}
          units={units}
          onClose={() => setShowItemForm(false)}
          onSaved={refresh}
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
