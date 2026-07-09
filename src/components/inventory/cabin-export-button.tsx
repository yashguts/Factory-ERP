"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  exportRowsToXlsx,
  exportSheetsToXlsx,
  type ExportColumn,
} from "@/lib/export/xlsx";
import { getCabinExportRows, type CabinExportRow } from "@/lib/actions/cabin";
import { CABIN_INVENTORY_TYPES } from "@/lib/cabin/cabin-types";

// Per-type sheets don't repeat the type (it's the sheet name).
const SHEET_COLUMNS: ExportColumn<CabinExportRow>[] = [
  { header: "Sub-type", field: (r) => r.sub_category ?? "" },
  { header: "Code", field: "code" },
  { header: "Item Name", field: "name" },
  { header: "Finish", field: (r) => r.finish ?? "" },
  { header: "Stock", field: "stock" },
  { header: "UOM", field: "uom" },
];

/**
 * "Export Excel" for Cabin Inventory. Without a typeId it exports EVERY cabin
 * item across all types — one sheet per type. With a typeId it exports that
 * type's full item list (all rows, not just the visible page). Data is fetched
 * on click so the pages never carry the ~10k-row payload.
 */
export function CabinExportButton({
  typeId,
  typeName,
}: {
  typeId?: string;
  typeName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run() {
    setBusy(true);
    try {
      const rows = await getCabinExportRows(typeId ?? null);
      if (rows.length === 0) {
        toast.error("Nothing to export");
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      if (typeId) {
        exportRowsToXlsx({
          rows,
          columns: SHEET_COLUMNS,
          filename: `Cabin-${typeName ?? "Type"}-${date}`,
          sheetName: typeName ?? "Items",
        });
      } else {
        const byType = new Map<string, CabinExportRow[]>();
        for (const r of rows) {
          const arr = byType.get(r.type) ?? [];
          arr.push(r);
          byType.set(r.type, arr);
        }
        // Sheets in the page's display order; any stray types go at the end.
        const order = (t: string) => {
          const i = (CABIN_INVENTORY_TYPES as readonly string[]).indexOf(t);
          return i === -1 ? CABIN_INVENTORY_TYPES.length : i;
        };
        const sheets = [...byType.entries()]
          .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
          .map(([name, typeRows]) => ({ name, rows: typeRows, columns: SHEET_COLUMNS }));
        exportSheetsToXlsx({ sheets, filename: `Cabin-Inventory-${date}` });
      }
      toast.success(`Exported ${rows.length.toLocaleString()} items`);
    } catch {
      toast.error("Export failed — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={run}
      title={
        typeId
          ? `Export every ${typeName ?? ""} item to Excel (ignores filters)`
          : "Export all cabin items to Excel — one sheet per type"
      }
    >
      {busy ? (
        <Loader2 size={14} className="mr-1.5 animate-spin" />
      ) : (
        <Download size={14} className="mr-1.5" />
      )}
      {busy ? "Exporting…" : "Export Excel"}
    </Button>
  );
}
