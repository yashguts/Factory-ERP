"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Cog, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ProgramFormModal } from "@/components/programs/program-form-modal";
import type { OperationListRow } from "@/lib/actions/operations";
import type { ItemCategory, UnitOfMeasurement, ItemType } from "@/lib/supabase/types";

interface Props {
  initialOperations: OperationListRow[];
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
}

export function ProgramsClient({
  initialOperations,
  categories,
  units,
  itemRefs,
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialOperations;
    const tokens = q.split(/\s+/).filter(Boolean);
    return initialOperations.filter((op) => {
      const hay = `${op.code ?? ""} ${op.name}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [initialOperations, search]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cog className="h-6 w-6 text-[var(--muted-foreground)]" />
            Programs
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            CNC Cutting nesting programs ·{" "}
            {initialOperations.length === 1
              ? "1 program"
              : `${initialOperations.length} programs`}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Program
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or name..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1"
          />
        </div>
      </div>

      {/* Table */}
      <div className="border border-[var(--border)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Code</TableHead>
              <TableHead>Program Name</TableHead>
              <TableHead className="w-[120px] text-right">Inputs</TableHead>
              <TableHead className="w-[120px] text-right">Outputs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-center py-12">
                  <div className="text-[var(--muted-foreground)]">
                    {initialOperations.length === 0 ? (
                      <>
                        <Cog className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium">No programs yet</p>
                        <p className="text-xs mt-1">
                          Add your first CNC cutting program — what it consumes
                          and the parts that come off the nest.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm">No programs match “{search}”.</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((op) => (
                <TableRow
                  key={op.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/programs/${op.id}`)}
                >
                  <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">
                    {op.code ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{op.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 text-[var(--muted-foreground)]">
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      {op.input_count}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 text-blue-700">
                      <ArrowUpFromLine className="h-3.5 w-3.5" />
                      {op.output_count}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {showCreate && (
        <ProgramFormModal
          categories={categories}
          units={units}
          itemRefs={itemRefs}
          onClose={() => setShowCreate(false)}
          onSaved={(id) => {
            setShowCreate(false);
            // Land on the new program's detail page so the user can add a
            // sketch and review the lines.
            router.push(`/programs/${id}`);
          }}
        />
      )}
    </div>
  );
}
