"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Plus, Search, Package } from "lucide-react";
import { ItemFormModal } from "@/components/inventory/item-form-modal";
import { StockAdjustModal } from "@/components/inventory/stock-adjust-modal";
import type { Item, ItemType } from "@/lib/supabase/types";

// Demo data until Supabase is connected
const DEMO_ITEMS: (Item & { uom_abbr: string; category_name: string; total_stock: number })[] = [
  {
    id: "1",
    code: "RM-MTR-001",
    name: "Geared Traction Motor 10HP",
    description: "Main drive motor for passenger elevators",
    item_type: "raw_material",
    category_id: "1",
    uom_id: "1",
    minimum_stock: 5,
    reorder_point: 3,
    lead_time_days: 30,
    cost_price: 45000,
    is_active: true,
    created_at: "",
    updated_at: "",
    uom_abbr: "nos",
    category_name: "Electrical",
    total_stock: 8,
  },
  {
    id: "2",
    code: "RM-GRL-001",
    name: "Guide Rail T89/B 5m",
    description: "Machined guide rails for car and counterweight",
    item_type: "raw_material",
    category_id: "3",
    uom_id: "1",
    minimum_stock: 40,
    reorder_point: 20,
    lead_time_days: 15,
    cost_price: 2800,
    is_active: true,
    created_at: "",
    updated_at: "",
    uom_abbr: "pcs",
    category_name: "Structural",
    total_stock: 12,
  },
  {
    id: "3",
    code: "SA-DOR-001",
    name: "Car Door Assembly - Standard",
    description: "Complete car door with operator and panels",
    item_type: "sub_assembly",
    category_id: "6",
    uom_id: "10",
    minimum_stock: 3,
    reorder_point: 2,
    lead_time_days: 7,
    cost_price: 32000,
    is_active: true,
    created_at: "",
    updated_at: "",
    uom_abbr: "set",
    category_name: "Doors",
    total_stock: 5,
  },
  {
    id: "4",
    code: "RM-WRR-001",
    name: "Wire Rope 12mm (per meter)",
    description: "Steel wire rope for suspension",
    item_type: "raw_material",
    category_id: "1",
    uom_id: "3",
    minimum_stock: 500,
    reorder_point: 200,
    lead_time_days: 10,
    cost_price: 180,
    is_active: true,
    created_at: "",
    updated_at: "",
    uom_abbr: "m",
    category_name: "Mechanical",
    total_stock: 350,
  },
  {
    id: "5",
    code: "RM-CTL-001",
    name: "Controller Panel - VVVF",
    description: "Variable voltage variable frequency drive controller",
    item_type: "raw_material",
    category_id: "2",
    uom_id: "1",
    minimum_stock: 3,
    reorder_point: 2,
    lead_time_days: 45,
    cost_price: 85000,
    is_active: true,
    created_at: "",
    updated_at: "",
    uom_abbr: "nos",
    category_name: "Electrical",
    total_stock: 4,
  },
  {
    id: "6",
    code: "FG-ELV-001",
    name: "Passenger Elevator 8-Person",
    description: "Complete passenger elevator system for 8 persons / 630kg",
    item_type: "finished_good",
    category_id: null,
    uom_id: "1",
    minimum_stock: 0,
    reorder_point: 0,
    lead_time_days: 60,
    cost_price: 850000,
    is_active: true,
    created_at: "",
    updated_at: "",
    uom_abbr: "nos",
    category_name: "-",
    total_stock: 0,
  },
];

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

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [showItemForm, setShowItemForm] = useState(false);
  const [showStockAdjust, setShowStockAdjust] = useState(false);
  const [selectedItem, setSelectedItem] = useState<typeof DEMO_ITEMS[0] | null>(null);

  const filtered = DEMO_ITEMS.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || item.item_type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Manage items, stock levels, and movements
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
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "raw_material", "sub_assembly", "finished_good"] as const).map(
            (type) => (
              <Button
                key={type}
                variant={typeFilter === type ? "primary" : "ghost"}
                size="sm"
                onClick={() => setTypeFilter(type)}
              >
                {type === "all" ? "All" : TYPE_LABELS[type]}
              </Button>
            )
          )}
        </div>
      </div>

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
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => {
              const isLow = item.total_stock <= item.reorder_point && item.reorder_point > 0;
              return (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedItem(item);
                    setShowItemForm(true);
                  }}
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
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[item.item_type]}`}
                    >
                      {TYPE_LABELS[item.item_type]}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{item.category_name}</TableCell>
                  <TableCell className="text-right font-medium">
                    <span className={isLow ? "text-[var(--destructive)]" : ""}>
                      {item.total_stock}
                    </span>{" "}
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {item.uom_abbr}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {item.minimum_stock} {item.uom_abbr}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {item.cost_price.toLocaleString("en-IN", {
                      style: "currency",
                      currency: "INR",
                      maximumFractionDigits: 0,
                    })}
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

      {showItemForm && (
        <ItemFormModal
          item={selectedItem}
          onClose={() => setShowItemForm(false)}
        />
      )}
      {showStockAdjust && (
        <StockAdjustModal onClose={() => setShowStockAdjust(false)} />
      )}
    </div>
  );
}
