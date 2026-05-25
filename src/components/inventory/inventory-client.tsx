"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Plus, Search, Package } from "lucide-react";
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
};

const TYPE_COLORS: Record<ItemType, string> = {
  raw_material: "bg-blue-100 text-blue-800",
  sub_assembly: "bg-purple-100 text-purple-800",
  finished_good: "bg-green-100 text-green-800",
};

export function InventoryClient({ initialItems, categories, units, warehouses }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [showItemForm, setShowItemForm] = useState(false);
  const [showStockAdjust, setShowStockAdjust] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithStock | null>(null);

  const filtered = initialItems.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || item.item_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {initialItems.length} items{isPending ? " — refreshing..." : ""}
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

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search by name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "raw_material", "sub_assembly", "finished_good"] as const).map((type) => (
            <Button
              key={type}
              variant={typeFilter === type ? "primary" : "ghost"}
              size="sm"
              onClick={() => setTypeFilter(type)}
            >
              {type === "all" ? "All" : TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-[var(--border)] rounded-lg p-12 text-center">
          <Package size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)]">
            {initialItems.length === 0
              ? "No items yet. Add your first item to get started."
              : "No items match your search."}
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Min Stock</TableHead>
                <TableHead className="text-right">Cost (INR)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const isLow = item.total_stock <= Number(item.reorder_point) && Number(item.reorder_point) > 0;
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
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
                    <TableCell className="text-right text-sm">
                      {Number(item.minimum_stock)} {item.uom?.abbreviation}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(item.cost_price).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell>
                      {isLow ? (
                        <span className="flex items-center gap-1 text-xs text-[var(--warning)]">
                          <Package size={12} /> Low
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--success)]">OK</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

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
