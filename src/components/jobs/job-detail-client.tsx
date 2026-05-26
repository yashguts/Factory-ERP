"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { ArrowLeft, Search, ArrowUpDown } from "lucide-react";
import { updateJob } from "@/lib/actions/jobs";
import type { Job, JobStatus } from "@/lib/supabase/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<JobStatus, string> = {
  draft: "bg-gray-100 text-gray-800",
  planned: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

interface BomLineWithItem {
  id: string;
  item_id: string;
  required_quantity: number;
  issued_quantity: number;
  wastage_percent: number;
  sort_order: number;
  source_col_index: number | null;
  item: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    category_id: string | null;
    uom_id: string;
    category: { name: string } | null;
    uom: { abbreviation: string } | null;
  } | null;
}

interface Props {
  job: Job;
  bomLines: BomLineWithItem[];
  bomHeaderId: string | null;
}

type SortKey = "code" | "name" | "category" | "required" | "issued";
type SortDir = "asc" | "desc";

export function JobDetailClient({ job, bomLines, bomHeaderId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [bomSearch, setBomSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const pct = Math.round((job.progress ?? 0) * 100);

  const handleStatusChange = (newStatus: JobStatus) => {
    startTransition(async () => {
      await updateJob(job.id, { status: newStatus });
      router.refresh();
    });
  };

  const filteredBom = useMemo(() => {
    if (!bomSearch) return bomLines;
    const q = bomSearch.toLowerCase();
    return bomLines.filter((line) => {
      const item = line.item;
      if (!item) return false;
      return (
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.category?.name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [bomLines, bomSearch]);

  const sortedBom = useMemo(() => {
    const copy = [...filteredBom];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code":
          cmp = (a.item?.code ?? "").localeCompare(b.item?.code ?? "");
          break;
        case "name":
          cmp = (a.item?.name ?? "").localeCompare(b.item?.name ?? "");
          break;
        case "category":
          cmp = (a.item?.category?.name ?? "").localeCompare(b.item?.category?.name ?? "");
          break;
        case "required":
          cmp = a.required_quantity - b.required_quantity;
          break;
        case "issued":
          cmp = a.issued_quantity - b.issued_quantity;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredBom, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortHeader = ({ label, sortField }: { label: string; sortField: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-[var(--muted)] transition-colors"
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={sortKey === sortField ? "text-[var(--primary)]" : "opacity-30"} />
      </span>
    </TableHead>
  );

  const MetaItem = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div>
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-sm font-medium">{value || "-"}</dd>
    </div>
  );

  return (
    <div>
      {/* Back + Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push("/jobs")}
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
        >
          <ArrowLeft size={14} /> Back to Jobs
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Job {job.job_number}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status]}`}>
                {STATUS_LABELS[job.status]}
              </span>
            </div>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              {job.customer_name || "No customer"}{job.brand ? ` — ${job.brand}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={job.status}
              onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
              className="w-[160px]"
              disabled={isPending}
            >
              {(Object.keys(STATUS_LABELS) as JobStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6 p-4 border border-[var(--border)] rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Progress</span>
          <span className="text-sm text-[var(--muted-foreground)]">{pct}%</span>
        </div>
        <div className="w-full h-3 bg-[var(--muted)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: pct === 100 ? "var(--success, #22c55e)" : "var(--primary)",
            }}
          />
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 border border-[var(--border)] rounded-lg">
        <MetaItem label="Spec" value={job.spec_string} />
        <MetaItem label="Floors" value={job.floors?.toString()} />
        <MetaItem label="Door Type" value={job.door_type} />
        <MetaItem label="Drive Type" value={job.drive_type} />
        <MetaItem label="Capacity" value={job.capacity} />
        <MetaItem label="Door Finish" value={job.door_finish} />
        <MetaItem label="Location" value={job.location} />
        <MetaItem label="Brand" value={job.brand} />
        <MetaItem
          label="Order Date"
          value={job.order_date ? new Date(job.order_date).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Expected Delivery"
          value={job.expected_delivery ? new Date(job.expected_delivery).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Planned Start"
          value={job.planned_start ? new Date(job.planned_start).toLocaleDateString("en-IN") : null}
        />
        <MetaItem
          label="Planned End"
          value={job.planned_end ? new Date(job.planned_end).toLocaleDateString("en-IN") : null}
        />
      </div>

      {job.remark && (
        <div className="mb-6 p-4 border border-[var(--border)] rounded-lg">
          <h3 className="text-sm font-medium mb-1">Remark</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{job.remark}</p>
        </div>
      )}

      {/* BOM Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Bill of Materials</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              {bomLines.length} items{filteredBom.length !== bomLines.length ? ` (${filteredBom.length} shown)` : ""}
            </p>
          </div>
          <div className="relative w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              placeholder="Search BOM items..."
              value={bomSearch}
              onChange={(e) => setBomSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {sortedBom.length === 0 ? (
          <div className="border border-[var(--border)] rounded-lg p-8 text-center">
            <p className="text-[var(--muted-foreground)]">
              {bomLines.length === 0
                ? "No BOM data yet. Import from Excel to populate."
                : "No BOM items match your search."}
            </p>
          </div>
        ) : (
          <div className="border border-[var(--border)] rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Code" sortField="code" />
                  <SortHeader label="Item" sortField="name" />
                  <SortHeader label="Category" sortField="category" />
                  <SortHeader label="Required" sortField="required" />
                  <SortHeader label="Issued" sortField="issued" />
                  <TableHead>Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedBom.map((line) => {
                  const remaining = line.required_quantity - line.issued_quantity;
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-xs">{line.item?.code ?? "-"}</TableCell>
                      <TableCell className="font-medium text-sm">{line.item?.name ?? "-"}</TableCell>
                      <TableCell className="text-sm">{line.item?.category?.name ?? "-"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(line.required_quantity).toLocaleString()}{" "}
                        <span className="text-xs text-[var(--muted-foreground)]">{line.item?.uom?.abbreviation}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm">{Number(line.issued_quantity).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">
                        <span className={remaining > 0 ? "text-amber-600" : "text-green-600"}>
                          {remaining > 0 ? remaining.toLocaleString() : "Done"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
