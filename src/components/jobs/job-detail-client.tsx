"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { ArrowLeft, Search, ArrowUpDown, Pencil } from "lucide-react";
import { updateJob } from "@/lib/actions/jobs";
import { BOM_SECTIONS, PHASE_ORDER } from "@/lib/bom/bom-sections";
import { shouldRenderSection } from "@/lib/bom/section-gating";
import type { Job, JobStatus, JobStage } from "@/lib/supabase/types";

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

const STAGE_LABELS: Record<JobStage, string> = {
  new: "New",
  first_phase_dispatched: "1st Phase Dispatched",
  second_phase_dispatched: "2nd Phase Dispatched",
  full_dispatched: "Full Dispatched",
};

interface BomLineWithItem {
  id: string;
  item_id: string | null;
  required_quantity: number;
  issued_quantity: number;
  wastage_percent: number;
  sort_order: number;
  source_col_index: number | null;
  category: string | null;
  variant: string | null;
  value_text: string | null;
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

interface BomSectionLine {
  category: string;
  variant: string;
  value_text: string | null;
  required_quantity: number;
}

interface Props {
  job: Job;
  bomLines: BomLineWithItem[];
  bomHeaderId: string | null;
  bomSectionLines: BomSectionLine[];
}

type SortKey = "code" | "name" | "category" | "required" | "issued";
type SortDir = "asc" | "desc";
type ViewTab = "sections" | "items";

export function JobDetailClient({ job, bomLines, bomHeaderId, bomSectionLines }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [bomSearch, setBomSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const hasItemBom = bomLines.some((l) => l.item_id != null);
  const hasSectionBom = bomSectionLines.length > 0;
  const [viewTab, setViewTab] = useState<ViewTab>(hasSectionBom ? "sections" : "items");

  const pct = Math.round((job.progress ?? 0) * 100);

  const handleStatusChange = (newStatus: JobStatus) => {
    startTransition(async () => {
      await updateJob(job.id, { status: newStatus });
      router.refresh();
    });
  };

  // Section-based BOM grouped by phase → category
  const sectionData = useMemo(() => {
    const lookup = new Map<string, BomSectionLine>();
    for (const l of bomSectionLines) {
      lookup.set(`${l.category}::${l.variant}`, l);
    }

    const phases: Array<{
      phase: string;
      sections: Array<{
        category: string;
        lines: Array<{ variant: string; value: string }>;
      }>;
    }> = [];

    for (const phase of PHASE_ORDER) {
      const sections = BOM_SECTIONS.filter(
        (s) =>
          s.phase === phase &&
          shouldRenderSection(s, job.door_type, job.drive_type),
      );

      const filledSections = sections
        .map((sec) => {
          const lines = sec.leaves
            .map((leaf) => {
              const line = lookup.get(`${sec.category}::${leaf.variant}`);
              if (!line) return null;
              const display =
                leaf.kind === "number"
                  ? line.required_quantity
                    ? `${Number(line.required_quantity).toLocaleString()}${leaf.unit ? ` ${leaf.unit}` : ""}`
                    : ""
                  : line.value_text ?? "";
              if (!display) return null;
              return { variant: leaf.variant, value: display };
            })
            .filter(Boolean) as Array<{ variant: string; value: string }>;

          if (lines.length === 0) return null;
          return { category: sec.category, lines };
        })
        .filter(Boolean) as Array<{
        category: string;
        lines: Array<{ variant: string; value: string }>;
      }>;

      if (filledSections.length > 0) {
        phases.push({ phase, sections: filledSections });
      }
    }

    return phases;
  }, [bomSectionLines, job.door_type, job.drive_type]);

  // Item-based BOM filtering/sorting
  const itemBomLines = useMemo(
    () => bomLines.filter((l) => l.item_id != null),
    [bomLines],
  );

  const filteredBom = useMemo(() => {
    if (!bomSearch) return itemBomLines;
    const q = bomSearch.toLowerCase();
    return itemBomLines.filter((line) => {
      const item = line.item;
      if (!item) return false;
      return (
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.category?.name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [itemBomLines, bomSearch]);

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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/jobs/${job.id}/edit`)}
            >
              <Pencil className="h-4 w-4 mr-1" />
              Edit BOM
            </Button>
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
        <MetaItem label="Stage" value={STAGE_LABELS[job.stage ?? "new"]} />
        <MetaItem label="Req. Stage" value={STAGE_LABELS[job.requirement_stage ?? "new"]} />
        <MetaItem
          label="Req. Dispatch Date"
          value={job.requirement_dispatch_date ? new Date(job.requirement_dispatch_date).toLocaleDateString("en-IN") : null}
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
            {(hasSectionBom && hasItemBom) && (
              <div className="flex gap-1 mt-2">
                <button
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    viewTab === "sections"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setViewTab("sections")}
                >
                  By Section ({bomSectionLines.length})
                </button>
                <button
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    viewTab === "items"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setViewTab("items")}
                >
                  By Item ({itemBomLines.length})
                </button>
              </div>
            )}
          </div>
          {viewTab === "items" && hasItemBom && (
            <div className="relative w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search BOM items..."
                value={bomSearch}
                onChange={(e) => setBomSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
        </div>

        {/* Section View */}
        {viewTab === "sections" && (
          hasSectionBom ? (
            <div className="space-y-6">
              {sectionData.map((phase) => (
                <div key={phase.phase}>
                  <h3 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
                    {phase.phase}
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {phase.sections.map((sec) => (
                      <div
                        key={sec.category}
                        className="border border-[var(--border)] rounded-lg p-4"
                      >
                        <h4 className="font-medium text-sm mb-2">{sec.category}</h4>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {sec.lines.map((line) => (
                            <div key={line.variant} className="flex justify-between text-sm py-0.5">
                              <span className="text-[var(--muted-foreground)] truncate mr-2">
                                {line.variant}
                              </span>
                              <span className="font-medium whitespace-nowrap">
                                {line.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-[var(--border)] rounded-lg p-8 text-center">
              <p className="text-[var(--muted-foreground)] mb-3">
                No section-based BOM data yet.
              </p>
              <Button
                variant="secondary"
                onClick={() => router.push(`/jobs/${job.id}/edit`)}
              >
                <Pencil className="h-4 w-4 mr-1" />
                Add BOM Data
              </Button>
            </div>
          )
        )}

        {/* Item View */}
        {viewTab === "items" && (
          hasItemBom ? (
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
          ) : (
            <div className="border border-[var(--border)] rounded-lg p-8 text-center">
              <p className="text-[var(--muted-foreground)]">
                No item-based BOM data. Import from Excel to populate.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
