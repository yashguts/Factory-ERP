"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { ImportPreviewTable } from "./import-preview-table";
import { parseCSV } from "@/lib/import/parse-csv";
import { parseDoorPanels } from "@/lib/import/templates/door-panels";
import { parseFinishedStock } from "@/lib/import/templates/finished-stock";
import { validateImportData, executeImport } from "@/lib/actions/import";
import type { ImportPreviewRow, ImportResult, ImportTemplate } from "@/lib/import/types";
import type { Warehouse } from "@/lib/supabase/types";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";

type Step = "upload" | "preview" | "result";

interface Props {
  warehouses: Warehouse[];
}

export function ImportClient({ warehouses }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("upload");
  const [template, setTemplate] = useState<ImportTemplate>("door-panels");
  const mainStore = warehouses.find((w) => w.name === "Main Store");
  const [warehouseId, setWarehouseId] = useState(mainStore?.id || warehouses[0]?.id || "");
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const csvRows = parseCSV(text);

        const parsed =
          template === "door-panels"
            ? parseDoorPanels(csvRows)
            : parseFinishedStock(csvRows);

        if (parsed.length === 0) {
          setError("No data rows found. Check that you selected the correct template.");
          return;
        }

        const previewRows: ImportPreviewRow[] = parsed.map((row, i) => ({
          ...row,
          row_number: i + 1,
          status: "valid",
          selected: true,
        }));

        startTransition(async () => {
          const validated = await validateImportData(previewRows);
          setRows(validated);
          setStep("preview");
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file");
      }
    };
    reader.readAsText(file);
  }

  function toggleRow(index: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
    );
  }

  function toggleAll(selected: boolean) {
    setRows((prev) =>
      prev.map((r) => (r.status === "valid" ? { ...r, selected } : r))
    );
  }

  function handleImport() {
    startTransition(async () => {
      const importResult = await executeImport(rows, warehouseId);
      setResult(importResult);
      setStep("result");
    });
  }

  if (step === "result" && result) {
    return (
      <div className="max-w-2xl mx-auto text-center py-10">
        <div className="mb-4">
          {result.errors.length === 0 ? (
            <CheckCircle size={48} className="mx-auto text-[var(--success)]" />
          ) : (
            <AlertCircle size={48} className="mx-auto text-[var(--warning)]" />
          )}
        </div>
        <h2 className="text-lg font-semibold mb-4">Import Complete</h2>
        <StatStrip className="mb-4 text-left">
          <StatTile label="Items Created" value={result.created} />
          <StatTile label="Stock Records Set" value={result.stock_set} />
          <StatTile label="Errors" value={result.errors.length} tone={result.errors.length > 0 ? "danger" : "default"} />
        </StatStrip>
        {result.errors.length > 0 && (
          <div className="text-left border border-[var(--destructive-border)] rounded-lg p-3 mb-4 max-h-48 overflow-auto">
            <h3 className="font-medium text-[var(--destructive)] mb-2">Errors:</h3>
            {result.errors.map((err, i) => (
              <p key={i} className="text-sm text-[var(--destructive)]">
                Row {err.row}: {err.message}
              </p>
            ))}
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <Button variant="secondary" onClick={() => router.push("/inventory")}>
            Go to Inventory
          </Button>
          <Button onClick={() => { setStep("upload"); setRows([]); setResult(null); }}>
            Import More
          </Button>
        </div>
      </div>
    );
  }

  if (step === "preview") {
    const selectedCount = rows.filter((r) => r.selected && r.status === "valid").length;
    return (
      <div>
        <PageHeader
          title="Preview Import"
          subtitle="Review and confirm the items to import"
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => { setStep("upload"); setRows([]); }}>
                <ArrowLeft size={16} className="mr-2" />
                Back
              </Button>
              <Button size="sm" onClick={handleImport} disabled={isPending || selectedCount === 0}>
                {isPending ? "Importing..." : `Import ${selectedCount} Items`}
              </Button>
            </>
          }
        />
        <ImportPreviewTable rows={rows} onToggleRow={toggleRow} onToggleAll={toggleAll} />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-6">
      <h2 className="text-lg font-semibold mb-4">Import Inventory from CSV</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Template</label>
          <Select
            value={template}
            onChange={(e) => setTemplate(e.target.value as ImportTemplate)}
          >
            <option value="door-panels">Door Panels (Sub-Assemblies)</option>
            <option value="finished-stock">Finished Stock (Trade/Make Items)</option>
          </Select>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {template === "door-panels"
              ? "For the 'Door Pannel' tab — generates SA-DP-* item codes"
              : "For the 'Finished Stock' tab — generates FG-*/SA-* codes based on Trade/Make"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Target Warehouse</label>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Upload CSV File</label>
          <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-6 text-center hover:border-[var(--primary)] transition-colors">
            <FileSpreadsheet size={28} className="mx-auto mb-2 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)] mb-3">
              Export the sheet tab as CSV from Google Sheets, then upload here
            </p>
            <label className="cursor-pointer">
              <Button variant="secondary" className="pointer-events-none">
                <Upload size={16} className="mr-2" />
                Choose CSV File
              </Button>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
          {error && (
            <p className="text-sm text-[var(--destructive)] mt-2">{error}</p>
          )}
          {isPending && (
            <p className="text-sm text-[var(--muted-foreground)] mt-2">Validating...</p>
          )}
        </div>
      </div>
    </div>
  );
}
