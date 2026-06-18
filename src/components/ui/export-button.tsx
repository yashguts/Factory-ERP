"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportRowsToXlsx, type ExportColumn } from "@/lib/export/xlsx";

/** Reusable "Export to Excel" button. Pass the currently-shown (filtered/sorted)
 *  rows + column defs; disabled when there's nothing to export. */
export function ExportButton<T>({
  rows,
  columns,
  filename,
  sheetName,
  label = "Export",
  className,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  sheetName?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      disabled={rows.length === 0}
      onClick={() => exportRowsToXlsx({ rows, columns, filename, sheetName })}
      title={rows.length ? `Export ${rows.length.toLocaleString()} rows to Excel` : "Nothing to export"}
    >
      <Download size={14} className="mr-1.5" /> {label}
    </Button>
  );
}
