"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import type { ImportPreviewRow } from "@/lib/import/types";

const STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  valid: "green",
  error: "red",
  duplicate: "amber",
};

interface Props {
  rows: ImportPreviewRow[];
  onToggleRow: (index: number) => void;
  onToggleAll: (selected: boolean) => void;
}

export function ImportPreviewTable({ rows, onToggleRow, onToggleAll }: Props) {
  const allSelected = rows.every((r) => r.selected || r.status !== "valid");
  const validCount = rows.filter((r) => r.status === "valid" && r.selected).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          {validCount} of {rows.length} items selected for import
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
            className="rounded"
          />
          Select all valid
        </label>
      </div>
      <div className="border border-[var(--border)] rounded-lg overflow-auto max-h-[500px]">
        <Table density="compact">
          <TableHeader sticky>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={i}
                className={row.status === "error" ? "bg-[var(--destructive-bg)]" : row.status === "duplicate" ? "bg-[var(--warning-bg)]" : ""}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={row.status !== "valid"}
                    onChange={() => onToggleRow(i)}
                    className="rounded"
                  />
                </TableCell>
                <TableCell className="text-[var(--muted-foreground)] text-xs">
                  {row.row_number}
                </TableCell>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-xs">
                  {row.item_type === "sub_assembly" ? "Make" : "Trade"}
                </TableCell>
                <TableCell className="text-xs">{row.sub_category_name}</TableCell>
                <TableCell className="text-right">{row.current_stock}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE_VARIANT[row.status] ?? "neutral"}>
                    {row.status}
                  </Badge>
                  {row.error && (
                    <span className="block text-xs text-[var(--destructive)] mt-0.5">{row.error}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
