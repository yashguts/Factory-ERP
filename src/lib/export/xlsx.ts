import * as XLSX from "xlsx";

/** A column in an Excel export: a header + how to pull the cell from a row. */
export interface ExportColumn<T> {
  header: string;
  /** A row key, or a function deriving the cell value. */
  field: keyof T | ((row: T) => string | number | null | undefined);
}

/**
 * Build an .xlsx from rows + column defs and trigger a browser download.
 * Client-side only (uses the same `xlsx` lib as the import flow). Nulls become
 * blank cells; the filename is sanitised and gets a single .xlsx suffix.
 */
export function exportRowsToXlsx<T>(opts: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  sheetName?: string;
}): void {
  const { rows, columns, filename, sheetName = "Sheet1" } = opts;
  const header = columns.map((c) => c.header);
  const body = rows.map((row) =>
    columns.map((c) => {
      const v = typeof c.field === "function" ? c.field(row) : (row as Record<string, unknown>)[c.field as string];
      return v == null ? "" : (v as string | number);
    }),
  );
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const safe = filename.replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_") || "export";
  XLSX.writeFile(wb, `${safe}.xlsx`);
}
