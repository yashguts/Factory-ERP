"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Container, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { CabinAddItemModal } from "@/components/inventory/cabin-add-item-modal";
import type { CabinItem } from "@/lib/actions/cabin";

interface Props {
  typeId: string;
  typeName: string;
  subCategories: { id: string; name: string }[];
  items: CabinItem[];
}

export function CabinTypeClient({ typeId, typeName, subCategories, items }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);

  const tokens = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (subFilter !== "all" && it.sub_category !== subFilter) return false;
      if (tokens.length > 0) {
        const hay = `${it.name} ${it.code} ${it.sub_category ?? ""}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [items, subFilter, tokens]);

  const inStock = filtered.filter((i) => i.total_stock > 0).length;

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/cabin-inventory"
          className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Cabin Inventory
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Container className="h-6 w-6" /> {typeName}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              {filtered.length} of {items.length} items · {inStock} in stock
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add item
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search code or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {subCategories.length > 0 && (
          <Select
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            className="w-[200px]"
          >
            <option value="all">All sub-types</option>
            {subCategories.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            {items.length === 0 ? "No items in this type yet." : "No items match your filters."}
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sub-type</TableHead>
                <TableHead className="text-right">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((it) => (
                <TableRow
                  key={it.id}
                  className="cursor-pointer hover:bg-[var(--muted)]"
                  onClick={() => router.push(`/inventory/${it.id}`)}
                >
                  <TableCell className="font-mono text-xs">{it.code}</TableCell>
                  <TableCell className="font-medium text-sm">{it.name}</TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {it.sub_category ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    <span
                      className={
                        it.total_stock > 0
                          ? "text-[var(--foreground)]"
                          : it.total_stock < 0
                            ? "text-red-600"
                            : "text-[var(--muted-foreground)]"
                      }
                    >
                      {it.total_stock.toLocaleString()}
                    </span>{" "}
                    <span className="text-xs text-[var(--muted-foreground)]">{it.uom}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showAdd && (
        <CabinAddItemModal
          typeId={typeId}
          typeName={typeName}
          subCategories={subCategories}
          onClose={() => setShowAdd(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
