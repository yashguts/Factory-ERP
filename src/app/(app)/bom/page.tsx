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
import { Plus, Search, ChevronRight, Layers } from "lucide-react";
import type { ItemType } from "@/lib/supabase/types";

interface BomDisplay {
  id: string;
  item_code: string;
  item_name: string;
  item_type: ItemType;
  version: number;
  line_count: number;
  is_active: boolean;
}

const DEMO_BOMS: BomDisplay[] = [
  {
    id: "1",
    item_code: "FG-ELV-001",
    item_name: "Passenger Elevator 8-Person",
    item_type: "finished_good",
    version: 1,
    line_count: 24,
    is_active: true,
  },
  {
    id: "2",
    item_code: "FG-ELV-002",
    item_name: "Passenger Elevator 13-Person",
    item_type: "finished_good",
    version: 1,
    line_count: 28,
    is_active: true,
  },
  {
    id: "3",
    item_code: "SA-DOR-001",
    item_name: "Car Door Assembly - Standard",
    item_type: "sub_assembly",
    version: 2,
    line_count: 8,
    is_active: true,
  },
  {
    id: "4",
    item_code: "SA-DOR-002",
    item_name: "Landing Door Assembly - Standard",
    item_type: "sub_assembly",
    version: 1,
    line_count: 6,
    is_active: true,
  },
  {
    id: "5",
    item_code: "SA-CBN-001",
    item_name: "Cabin Assembly - SS Hairline",
    item_type: "sub_assembly",
    version: 1,
    line_count: 12,
    is_active: true,
  },
];

const TYPE_COLORS: Record<ItemType, string> = {
  raw_material: "bg-blue-100 text-blue-800",
  sub_assembly: "bg-purple-100 text-purple-800",
  finished_good: "bg-green-100 text-green-800",
  mechanical_finished_stock: "bg-amber-100 text-amber-800",
};

export default function BomPage() {
  const [search, setSearch] = useState("");

  const filtered = DEMO_BOMS.filter(
    (bom) =>
      bom.item_name.toLowerCase().includes(search.toLowerCase()) ||
      bom.item_code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Bill of Materials</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Manage multi-level BOMs for elevator assemblies
          </p>
        </div>
        <Button>
          <Plus size={16} className="mr-2" />
          Create BOM
        </Button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search BOMs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="border border-[var(--border)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item Code</TableHead>
              <TableHead>Item Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Version</TableHead>
              <TableHead className="text-right">Components</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((bom) => (
              <TableRow key={bom.id} className="cursor-pointer">
                <TableCell className="font-mono text-xs">{bom.item_code}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-[var(--muted-foreground)]" />
                    <span className="font-medium">{bom.item_name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[bom.item_type]}`}>
                    {bom.item_type === "finished_good" ? "Finished Good" : "Sub Assembly"}
                  </span>
                </TableCell>
                <TableCell>v{bom.version}</TableCell>
                <TableCell className="text-right">{bom.line_count} items</TableCell>
                <TableCell>
                  {bom.is_active ? (
                    <span className="text-xs text-[var(--success)]">Active</span>
                  ) : (
                    <span className="text-xs text-[var(--muted-foreground)]">Inactive</span>
                  )}
                </TableCell>
                <TableCell>
                  <ChevronRight size={16} className="text-[var(--muted-foreground)]" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
