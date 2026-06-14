"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, Check, Search, AlertTriangle } from "lucide-react";
import { resolveColumnMapping, saveColumnMapping, validateJobImport, executeJobImport } from "@/lib/actions/jobs-import";
import { parseJobRow, parseHeaderRow, parseBomQuantities } from "@/lib/import/parse-target-list";
import type { ColumnMatchResult, ParsedJobRow, JobImportResult } from "@/lib/import/types";
import * as XLSX from "xlsx";

type Step = "upload" | "columns" | "preview" | "result";

interface JobPreviewRow extends ParsedJobRow {
  row_number: number;
  status: "new" | "update" | "error";
  error?: string;
  selected: boolean;
  bom_item_count: number;
}

export function ImportWizard() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("upload");

  // Upload state
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [rawRows, setRawRows] = useState<unknown[][]>([]);

  // Column mapping state
  const [columnResults, setColumnResults] = useState<ColumnMatchResult[]>([]);
  const [columnSearch, setColumnSearch] = useState("");

  // Preview state
  const [jobPreviews, setJobPreviews] = useState<JobPreviewRow[]>([]);
  const [previewSearch, setPreviewSearch] = useState("");

  // Result state
  const [importResult, setImportResult] = useState<JobImportResult | null>(null);

  // ---------- Step 1: Upload ----------
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      if (!data) return;
      const workbook = XLSX.read(data, { type: "array" });
      setSheetNames(workbook.SheetNames);
      setSelectedSheet(workbook.SheetNames[0] || "");
    };
    reader.readAsArrayBuffer(file);
  };

  const handleParseSheet = () => {
    if (!selectedSheet) return;

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      if (!data) return;
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[selectedSheet];
      if (!sheet) return;

      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      setRawRows(rows);

      // Parse header row and resolve columns
      const headerRow = rows[0];
      if (!headerRow) return;

      const columns = parseHeaderRow(headerRow as unknown[]);

      startTransition(async () => {
        const results = await resolveColumnMapping(columns);
        setColumnResults(results);
        setStep("columns");
      });
    };
    reader.readAsArrayBuffer(file);
  };

  // ---------- Step 2: Column Mapping ----------
  const matchedCount = columnResults.filter((c) => c.match_status === "matched").length;
  const unmatchedCount = columnResults.filter((c) => c.match_status === "unmatched").length;

  const filteredColumns = useMemo(() => {
    if (!columnSearch) return columnResults;
    const q = columnSearch.toLowerCase();
    return columnResults.filter((c) =>
      c.column_label.toLowerCase().includes(q) ||
      (c.item_code?.toLowerCase().includes(q) ?? false) ||
      (c.item_name?.toLowerCase().includes(q) ?? false)
    );
  }, [columnResults, columnSearch]);

  const handleSkipColumn = (colIndex: number) => {
    setColumnResults((prev) =>
      prev.map((c) =>
        c.column_index === colIndex
          ? { ...c, match_status: "skipped" as const, item_id: null, item_code: null, item_name: null }
          : c
      )
    );
  };

  const handleSaveColumnsAndContinue = () => {
    startTransition(async () => {
      // Save column mapping
      const mappings = columnResults
        .filter((c) => c.match_status === "matched")
        .map((c) => ({
          column_index: c.column_index,
          column_label: c.column_label,
          item_id: c.item_id,
          item_lookup_key: c.column_label,
        }));

      await saveColumnMapping(mappings);

      // Parse job rows
      const jobRows: ParsedJobRow[] = [];
      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || !Array.isArray(row)) continue;
        const parsed = parseJobRow(row);
        if (parsed) jobRows.push(parsed);
      }

      // Build column map for BOM quantities
      const columnMap = new Map<number, string>();
      for (const col of columnResults) {
        if (col.match_status === "matched" && col.item_id) {
          columnMap.set(col.column_index, col.item_id);
        }
      }

      // Validate jobs
      const validated = await validateJobImport(jobRows);

      // Build preview rows with BOM counts
      const previews: JobPreviewRow[] = validated.map((v, idx) => {
        const rowIdx = idx + 1; // header is row 0
        const bomItems = parseBomQuantities(rawRows[rowIdx] as unknown[], columnMap);
        return {
          ...v.job,
          row_number: rowIdx + 1,
          status: v.status,
          error: v.error,
          selected: v.status !== "error",
          bom_item_count: bomItems.length,
        };
      });

      setJobPreviews(previews);
      setStep("preview");
    });
  };

  // ---------- Step 3: Preview ----------
  const filteredPreviews = useMemo(() => {
    if (!previewSearch) return jobPreviews;
    const q = previewSearch.toLowerCase();
    return jobPreviews.filter((j) =>
      j.job_number.toLowerCase().includes(q) ||
      j.customer_name.toLowerCase().includes(q) ||
      j.location.toLowerCase().includes(q)
    );
  }, [jobPreviews, previewSearch]);

  const selectedCount = jobPreviews.filter((j) => j.selected).length;

  const toggleJob = (rowNum: number) => {
    setJobPreviews((prev) =>
      prev.map((j) =>
        j.row_number === rowNum ? { ...j, selected: !j.selected } : j
      )
    );
  };

  const toggleAll = () => {
    const allSelected = jobPreviews.every((j) => j.selected || j.status === "error");
    setJobPreviews((prev) =>
      prev.map((j) =>
        j.status === "error" ? j : { ...j, selected: !allSelected }
      )
    );
  };

  const handleExecuteImport = () => {
    startTransition(async () => {
      const selectedJobs = jobPreviews.filter((j) => j.selected);

      // Build column map for BOM
      const columnMap = new Map<number, string>();
      for (const col of columnResults) {
        if (col.match_status === "matched" && col.item_id) {
          columnMap.set(col.column_index, col.item_id);
        }
      }

      // Build BOM data for each selected job
      const bomData = selectedJobs.map((job) => {
        const rowIdx = job.row_number - 1; // convert back to 0-indexed
        const items = parseBomQuantities(rawRows[rowIdx] as unknown[], columnMap);
        return {
          jobNumber: job.job_number,
          items: items.map((i) => ({ itemId: i.itemId, quantity: i.quantity, colIndex: i.colIndex })),
        };
      });

      const jobs: ParsedJobRow[] = selectedJobs.map((j) => ({
        job_number: j.job_number,
        customer_name: j.customer_name,
        progress: j.progress,
        spec_string: j.spec_string,
        door_finish: j.door_finish,
        location: j.location,
        expected_delivery: j.expected_delivery,
        remark: j.remark,
        order_date: j.order_date,
        floors: j.floors,
        door_type: j.door_type,
        drive_type: j.drive_type,
        capacity: j.capacity,
        brand: j.brand,
      }));

      const result = await executeJobImport(jobs, bomData);
      setImportResult(result);
      setStep("result");
    });
  };

  // ---------- Render ----------
  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Import Jobs from Excel"
        subtitle="Upload your Target List Excel to import job orders and BOM requirements"
        onBack={() => router.push("/jobs")}
      />

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-4">
        {(["upload", "columns", "preview", "result"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-[var(--border)]" />}
            <div
              className={`flex items-center gap-1.5 text-sm px-3 py-1 rounded-full ${
                step === s
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : ["upload", "columns", "preview", "result"].indexOf(step) > i
                  ? "bg-[var(--success-bg)] text-[var(--success)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              }`}
            >
              <span className="font-medium">{i + 1}.</span>
              {s === "upload" ? "Upload" : s === "columns" ? "Map Columns" : s === "preview" ? "Preview" : "Result"}
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="max-w-xl space-y-4">
          <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-6 text-center hover:border-[var(--primary)] transition-colors">
            <Upload size={28} className="mx-auto mb-2 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)] mb-3">
              Select your Target List Excel file (.xlsx)
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="block mx-auto text-sm"
            />
          </div>

          {sheetNames.length > 0 && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Select Sheet</label>
                <Select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </Select>
              </div>
              <Button onClick={handleParseSheet} disabled={isPending || !selectedSheet}>
                {isPending ? "Parsing..." : "Parse & Continue"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === "columns" && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-sm">
                <Badge variant="green" dot />
                <span>Matched: {matchedCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <Badge variant="amber" dot />
                <span>Unmatched: {unmatchedCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <Badge variant="neutral" dot />
                <span>Skipped: {columnResults.filter((c) => c.match_status === "skipped").length}</span>
              </div>
            </div>
            <div className="relative w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                size="sm"
                placeholder="Search columns..."
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="border border-[var(--border)] rounded-lg max-h-[60vh] overflow-y-auto">
            <Table density="compact">
              <TableHeader sticky>
                <TableRow>
                  <TableHead className="w-16">Col #</TableHead>
                  <TableHead>Excel Header</TableHead>
                  <TableHead>Matched Item</TableHead>
                  <TableHead>Item Code</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-20">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredColumns.map((col) => (
                  <TableRow
                    key={col.column_index}
                    className={col.match_status === "unmatched" ? "bg-[var(--warning-bg)]" : ""}
                  >
                    <TableCell className="font-mono text-xs">{col.column_index}</TableCell>
                    <TableCell className="text-sm font-medium">{col.column_label}</TableCell>
                    <TableCell className="text-sm">{col.item_name ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{col.item_code ?? "-"}</TableCell>
                    <TableCell>
                      {col.match_status === "matched" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
                          <Check size={12} /> Matched
                        </span>
                      ) : col.match_status === "skipped" ? (
                        <span className="text-xs text-[var(--muted-foreground)]">Skipped</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--warning)]">
                          <AlertTriangle size={12} /> No match
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {col.match_status === "unmatched" && (
                        <button
                          onClick={() => handleSkipColumn(col.column_index)}
                          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                        >
                          Skip
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="secondary" onClick={() => setStep("upload")}>Back</Button>
            <Button size="sm" onClick={handleSaveColumnsAndContinue} disabled={isPending}>
              {isPending ? "Processing..." : "Save Mapping & Continue"}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="flex items-center gap-4">
              <span className="text-sm">
                {selectedCount} of {jobPreviews.length} jobs selected
              </span>
              <span className="text-sm text-[var(--success)]">
                New: {jobPreviews.filter((j) => j.status === "new").length}
              </span>
              <span className="text-sm text-[var(--primary)]">
                Update: {jobPreviews.filter((j) => j.status === "update").length}
              </span>
              {jobPreviews.some((j) => j.status === "error") && (
                <span className="text-sm text-[var(--destructive)]">
                  Errors: {jobPreviews.filter((j) => j.status === "error").length}
                </span>
              )}
            </div>
            <div className="relative w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                size="sm"
                placeholder="Search jobs..."
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="border border-[var(--border)] rounded-lg max-h-[60vh] overflow-y-auto">
            <Table density="compact">
              <TableHeader sticky>
                <TableRow>
                  <TableHead className="w-12">
                    <input type="checkbox" checked={selectedCount === jobPreviews.filter((j) => j.status !== "error").length} onChange={toggleAll} />
                  </TableHead>
                  <TableHead>Job #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>BOM Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPreviews.map((job) => (
                  <TableRow
                    key={job.row_number}
                    className={job.status === "error" ? "bg-[var(--destructive-bg)] opacity-60" : ""}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={job.selected}
                        onChange={() => toggleJob(job.row_number)}
                        disabled={job.status === "error"}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{job.job_number}</TableCell>
                    <TableCell className="text-sm">{job.customer_name || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{job.spec_string || "-"}</TableCell>
                    <TableCell className="text-sm">{job.location || "-"}</TableCell>
                    <TableCell className="text-sm">{Math.round((job.progress ?? 0) * 100)}%</TableCell>
                    <TableCell className="text-sm font-medium">{job.bom_item_count}</TableCell>
                    <TableCell>
                      {job.status === "new" ? (
                        <Badge variant="green">New</Badge>
                      ) : job.status === "update" ? (
                        <Badge variant="blue">Update</Badge>
                      ) : (
                        <Badge variant="red" title={job.error}>
                          Error
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="secondary" onClick={() => setStep("columns")}>Back</Button>
            <Button
              size="sm"
              onClick={handleExecuteImport}
              disabled={isPending || selectedCount === 0}
            >
              {isPending ? "Importing..." : `Import ${selectedCount} Jobs`}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Result */}
      {step === "result" && importResult && (
        <div>
          <StatStrip className="mb-4">
            <StatTile label="Total Jobs" value={importResult.total_jobs} />
            <StatTile label="Created" value={importResult.created} tone="ok" />
            <StatTile label="Updated" value={importResult.updated} tone="primary" />
            <StatTile label="BOM Lines" value={importResult.bom_lines_created} />
          </StatStrip>

          {importResult.errors.length > 0 && (
            <div className="border border-[var(--destructive-border)] rounded-lg p-3 mb-4 bg-[var(--destructive-bg)]">
              <h3 className="text-sm font-medium text-[var(--destructive)] mb-2">
                {importResult.errors.length} Errors
              </h3>
              <div className="max-h-48 overflow-auto space-y-1">
                {importResult.errors.map((err, i) => (
                  <p key={i} className="text-xs text-[var(--destructive)]">
                    Row {err.row}: {err.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          <Button onClick={() => router.push("/jobs")}>
            View Jobs
          </Button>
        </div>
      )}
    </div>
  );
}
