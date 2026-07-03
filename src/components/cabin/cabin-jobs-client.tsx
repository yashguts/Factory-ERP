"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { Plus, Search, ClipboardCheck, Copy, ArrowUpDown, ChevronDown, ChevronRight, Palette, Layers, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { Tabs } from "@/components/ui/tabs";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import type { ExportColumn } from "@/lib/export/xlsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { CabinJobsPopover } from "@/components/cabin/cabin-jobs-popover";
import { WeeklyMatrix, CumulativeToggle, type MatrixRow } from "@/components/mrp/weekly-matrix";
import { setCabinJobReady, setCabinJobReviewed } from "@/lib/actions/cabin-jobs";
import type { CabinJobListRow, CabinFinishGroup, CabinFinishItem } from "@/lib/actions/cabin-jobs";
import type { CabinWeeklyPlan } from "@/lib/actions/cabin-program-plan";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// The platform item name leads with its door system (e.g. "ACO 1300X1100",
// "CC 1000X1000", "AT 1000X2200_3MM", "AFFG 2000X2550…", "SWG_1000X700…").
// The first token is that system — used for the Door-system filter.
function platformSystem(platform: string | null): string | null {
  if (!platform) return null;
  const tok = platform.trim().split(/[\s_]+/)[0];
  return tok ? tok.toUpperCase() : null;
}

// A job's Side Panel material can be a set, e.g. "SS 430 + White Mirror Silver".
// Split it back into the individual finishes for filtering.
function splitMaterials(material: string | null): string[] {
  if (!material) return [];
  return material.split(" + ").map((s) => s.trim()).filter(Boolean);
}

type SortKey = "job_number" | "platform" | "side_panel" | "items" | "created";
type SortDir = "asc" | "desc";
type View = "jobs" | "finish" | "category" | "weekly";

/** One item within a cabin part category — the finish view's item, tagged with
 *  the finish it came from (so the category view can show finish per item). */
interface CabinCategoryItem extends CabinFinishItem {
  finish: string | null;
}
interface CabinCategoryGroup {
  category: string;
  total_qty: number;
  job_count: number;
  items: CabinCategoryItem[];
}

/** Re-group the by-finish requirement by cabin part category (Platform, Side
 *  Panel, Canopy, …). Each item belongs to exactly one finish group, so flatten
 *  + regroup gives the same demand sliced the other way. */
function buildCategoryGroups(finishReq: CabinFinishGroup[]): CabinCategoryGroup[] {
  const byCat = new Map<string, { items: CabinCategoryItem[]; jobs: Set<string> }>();
  for (const g of finishReq) {
    for (const it of g.items) {
      const cat = it.cabin_type || "(uncategorised)";
      const entry = byCat.get(cat) ?? { items: [], jobs: new Set<string>() };
      entry.items.push({ ...it, finish: g.finish });
      for (const j of it.jobs) entry.jobs.add(j.job_id);
      byCat.set(cat, entry);
    }
  }
  return [...byCat.entries()]
    .map(([category, e]) => ({
      category,
      total_qty: e.items.reduce((s, x) => s + x.qty, 0),
      job_count: e.jobs.size,
      items: e.items.sort((a, b) => b.qty - a.qty),
    }))
    .sort((a, b) => b.total_qty - a.total_qty);
}

export function CabinJobsClient({
  jobs,
  finishReq,
  weeklyPlan,
}: {
  jobs: CabinJobListRow[];
  finishReq: CabinFinishGroup[];
  weeklyPlan: CabinWeeklyPlan;
}) {
  const router = useRouter();
  const toast = useToast();
  // Optimistic ready state overlay — reflects a toggle instantly over the server prop.
  const [readyOverride, setReadyOverride] = useState<Record<string, boolean>>({});
  const isReady = (j: CabinJobListRow) => readyOverride[j.id] ?? j.marked_ready_at != null;
  async function toggleReady(j: CabinJobListRow) {
    const next = !isReady(j);
    setReadyOverride((m) => ({ ...m, [j.id]: next }));
    const res = await setCabinJobReady(j.id, next);
    if (!res.ok) {
      setReadyOverride((m) => ({ ...m, [j.id]: !next }));
      toast.error(res.error);
      return;
    }
    toast.success(next ? `${j.job_number} marked ready` : `${j.job_number} reopened`);
    router.refresh();
  }

  // Optimistic reviewed overlay — AI drafts (reviewed_at NULL) are excluded from
  // cabin demand until an engineer marks them reviewed.
  const [reviewedOverride, setReviewedOverride] = useState<Record<string, boolean>>({});
  const isReviewed = (j: CabinJobListRow) => reviewedOverride[j.id] ?? j.reviewed_at != null;
  async function markReviewed(j: CabinJobListRow) {
    setReviewedOverride((m) => ({ ...m, [j.id]: true }));
    const res = await setCabinJobReviewed(j.id, true);
    if (!res.ok) {
      setReviewedOverride((m) => ({ ...m, [j.id]: false }));
      toast.error(res.error);
      return;
    }
    toast.success(`${j.job_number} reviewed — now counts in the cabin requirement`);
    router.refresh();
  }
  const draftCount = jobs.filter((j) => !isReviewed(j)).length;
  const sp = useSearchParams();
  const [view, setView] = useState<View>(() => readParam(sp, "view", "jobs", ["jobs", "finish", "category", "weekly"]) as View);
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [systemFilter, setSystemFilter] = useState<string>(() => readParam(sp, "sys", "all"));
  const [materialFilter, setMaterialFilter] = useState<string>(() => readParam(sp, "mat", "all"));
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "created", ["job_number", "platform", "side_panel", "items", "created"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "desc", ["asc", "desc"]) as SortDir,
  );
  // Weekly-plan view controls.
  const [cumulative, setCumulative] = useState(() => readParam(sp, "cumul", "1") !== "0");
  const [weeklyFinish, setWeeklyFinish] = useState(() => readParam(sp, "wfin", "all"));

  useUrlListSync(
    { view, q: search, sys: systemFilter, mat: materialFilter, sort: sortKey, dir: sortDir, cumul: cumulative ? "1" : "0", wfin: weeklyFinish },
    { view: "jobs", q: "", sys: "all", mat: "all", sort: "created", dir: "desc", cumul: "1", wfin: "all" },
  );

  // Filter option lists, derived from the data so they only show what exists.
  const systems = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => {
      const s = platformSystem(j.platform);
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [jobs]);

  const materials = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => splitMaterials(j.side_panel_material).forEach((m) => set.add(m)));
    return Array.from(set).sort();
  }, [jobs]);

  const categoryReq = useMemo(() => buildCategoryGroups(finishReq), [finishReq]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return jobs.filter((j) => {
      if (tokens.length) {
        const hay = `${j.job_number} ${j.customer_name ?? ""} ${j.platform ?? ""} ${j.side_panel_material ?? ""}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      if (systemFilter !== "all" && platformSystem(j.platform) !== systemFilter) return false;
      if (materialFilter !== "all" && !splitMaterials(j.side_panel_material).includes(materialFilter)) return false;
      return true;
    });
  }, [jobs, search, systemFilter, materialFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "job_number":
          cmp = a.job_number.localeCompare(b.job_number, undefined, { numeric: true });
          break;
        case "platform":
          cmp = (a.platform ?? "").localeCompare(b.platform ?? "");
          break;
        case "side_panel":
          cmp = (a.side_panel_material ?? "").localeCompare(b.side_panel_material ?? "");
          break;
        case "items":
          cmp = a.line_count - b.line_count;
          break;
        case "created":
          cmp = a.created_at.localeCompare(b.created_at);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
    }
  };

  const filtersActive = search.trim() !== "" || systemFilter !== "all" || materialFilter !== "all";

  // View-aware export: each tab exports exactly the rows it's showing. The jobs
  // tab exports the filtered+sorted job list; the finish/category tabs export
  // their drilled-down items (one row per item, tagged with its group). The
  // weekly tab is a per-week matrix (not flat) so it falls back to the job list.
  const exportConfig = useMemo<{
    rows: Record<string, string | number | null>[];
    columns: ExportColumn<Record<string, string | number | null>>[];
    filename: string;
    sheet: string;
  }>(() => {
    if (view === "finish") {
      const rows = finishReq.flatMap((g) =>
        g.items.map((it) => ({
          finish: g.finish ?? "(no finish set)",
          code: it.code,
          name: it.name,
          cabin_type: it.cabin_type ?? "",
          qty: it.qty,
        })),
      );
      return {
        rows,
        columns: [
          { header: "Finish", field: "finish" },
          { header: "Code", field: "code" },
          { header: "Item", field: "name" },
          { header: "Category", field: "cabin_type" },
          { header: "Qty", field: "qty" },
        ],
        filename: "cabin-requirement-by-finish",
        sheet: "By finish",
      };
    }
    if (view === "category") {
      const rows = categoryReq.flatMap((g) =>
        g.items.map((it) => ({
          category: g.category,
          code: it.code,
          name: it.name,
          finish: it.finish ?? "(no finish set)",
          qty: it.qty,
        })),
      );
      return {
        rows,
        columns: [
          { header: "Category", field: "category" },
          { header: "Code", field: "code" },
          { header: "Item", field: "name" },
          { header: "Finish", field: "finish" },
          { header: "Qty", field: "qty" },
        ],
        filename: "cabin-requirement-by-category",
        sheet: "By category",
      };
    }
    // jobs (default) + weekly fall back to the job list.
    const rows = sorted.map((j) => ({
      job_number: j.job_number,
      customer_name: j.customer_name ?? "",
      platform: j.platform ?? "",
      side_panel_material: j.side_panel_material ?? "",
      line_count: j.line_count,
      created_at: new Date(j.created_at).toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    }));
    return {
      rows,
      columns: [
        { header: "Job #", field: "job_number" },
        { header: "Customer", field: "customer_name" },
        { header: "Platform", field: "platform" },
        { header: "Side Panel", field: "side_panel_material" },
        { header: "Items", field: "line_count" },
        { header: "Created", field: "created_at" },
      ],
      filename: "cabin-jobs",
      sheet: "Cabin jobs",
    };
  }, [view, sorted, finishReq, categoryReq]);

  const SortHeader = ({ label, sortField, className }: { label: string; sortField: SortKey; className?: string }) => (
    <TableHead
      className={`cursor-pointer select-none hover:bg-[var(--muted)] transition-colors ${className ?? ""}`}
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={sortKey === sortField ? "text-[var(--primary)]" : "opacity-30"} />
      </span>
    </TableHead>
  );

  return (
    <div>
      <PageHeader
        icon={<ClipboardCheck size={18} />}
        title="Cabin Jobs"
        meta={
          view === "finish"
            ? "Cumulative sheet/plate requirement by finish, across all cabin jobs"
            : view === "category"
              ? "Cumulative requirement by cabin part category, across all cabin jobs"
              : view === "weekly"
                ? "Parts by category (sorted by finish), required week by week"
                : filtersActive
                  ? `${sorted.length} of ${jobs.length} cabin job${jobs.length === 1 ? "" : "s"}${draftCount > 0 ? ` · ${draftCount} AI draft${draftCount === 1 ? "" : "s"} to review` : ""}`
                  : `${jobs.length} cabin job${jobs.length === 1 ? "" : "s"}${draftCount > 0 ? ` · ${draftCount} AI draft${draftCount === 1 ? "" : "s"} to review` : ""}`
        }
        actions={
          <>
            <ExportButton
              rows={exportConfig.rows}
              columns={exportConfig.columns}
              filename={exportConfig.filename}
              sheetName={exportConfig.sheet}
            />
            <Button size="sm" onClick={() => router.push("/cabin-jobs/new")}>
              <Plus size={16} className="mr-1.5" /> New Cabin Job
            </Button>
          </>
        }
      />

      <Tabs
        variant="underline"
        className="mb-4"
        value={view}
        onChange={(v) => setView(v as View)}
        tabs={[
          { value: "jobs", label: "Cabin jobs", count: jobs.length },
          { value: "finish", label: "Requirement by finish", count: finishReq.length },
          { value: "category", label: "Requirement by category", count: categoryReq.length },
          { value: "weekly", label: "Weekly plan", count: weeklyPlan.rows.length },
        ]}
      />

      {view === "finish" ? (
        <FinishRequirement groups={finishReq} />
      ) : view === "category" ? (
        <CategoryRequirement groups={categoryReq} />
      ) : view === "weekly" ? (
        <WeeklyRequirement
          plan={weeklyPlan}
          cumulative={cumulative}
          onCumulative={setCumulative}
          finish={weeklyFinish}
          onFinish={setWeeklyFinish}
        />
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                size="sm"
                placeholder="Search job #, platform, material..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={jobs.length === 0}
                className="pl-9"
              />
            </div>

            {systems.length > 0 && (
              <Select
                size="sm"
                value={systemFilter}
                onChange={(e) => setSystemFilter(e.target.value)}
                className="w-[150px]"
                title="Filter by platform door system"
              >
                <option value="all">All Platforms</option>
                {systems.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            )}

            {materials.length > 0 && (
              <Select
                size="sm"
                value={materialFilter}
                onChange={(e) => setMaterialFilter(e.target.value)}
                className="w-[160px]"
                title="Filter by side panel material"
              >
                <option value="all">All Side Panels</option>
                {materials.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            )}

            {filtersActive && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setSystemFilter("all");
                  setMaterialFilter("all");
                }}
              >
                Clear
              </Button>
            )}
            <ToolbarSpacer />
          </Toolbar>

          {sorted.length === 0 ? (
            <div className="card-surface">
              <EmptyState
                icon={<ClipboardCheck size={28} />}
                title={jobs.length === 0 ? "No cabin jobs yet" : "No cabin jobs match your filters"}
                description={
                  jobs.length === 0
                    ? "Create one to start listing cabin items by type."
                    : "Try clearing the search or filters."
                }
              />
            </div>
          ) : (
            <div className="card-surface overflow-hidden">
              <Table density="dense">
                <TableHeader sticky>
                  <TableRow>
                    <SortHeader label="Job #" sortField="job_number" />
                    <TableHead>Customer</TableHead>
                    <SortHeader label="Platform" sortField="platform" />
                    <SortHeader label="Side Panel" sortField="side_panel" />
                    <SortHeader label="Items" sortField="items" className="text-right" />
                    <SortHeader label="Created" sortField="created" />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((j) => (
                    <TableRow
                      key={j.id}
                      className={cn("cursor-pointer hover:bg-[var(--muted)]", isReady(j) && "opacity-60")}
                      onClick={() => router.push(`/cabin-jobs/${j.id}`)}
                    >
                      <TableCell className="font-mono font-medium">
                        {j.job_number}
                        {!isReviewed(j) && (
                          <span
                            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300"
                            title="AI-drafted — excluded from the cabin requirement until reviewed"
                          >
                            Draft
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{j.customer_name || "—"}</TableCell>
                      <TableCell className="font-mono text-[13px]">{j.platform || "—"}</TableCell>
                      <TableCell>{j.side_panel_material || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{j.line_count}</TableCell>
                      <TableCell className="text-[var(--muted-foreground)]">
                        {new Date(j.created_at).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isReviewed(j) && (
                            <Button
                              size="sm"
                              variant="primary"
                              className="cursor-pointer"
                              title="Open the draft to review its sketch, or mark it reviewed right here"
                              onClick={(e) => {
                                e.stopPropagation();
                                markReviewed(j);
                              }}
                            >
                              <ClipboardCheck size={14} className="mr-1.5" /> Review ✓
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={isReady(j) ? "secondary" : "primary"}
                            className="cursor-pointer"
                            title={
                              isReady(j)
                                ? "Ready — its items are excluded from the cabin requirement. Click to reopen."
                                : "Mark ready — stop counting its items in the cabin requirement"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleReady(j);
                            }}
                          >
                            <Check size={14} className="mr-1.5" /> {isReady(j) ? "Ready" : "Mark Ready"}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="cursor-pointer"
                            title={`Clone ${j.job_number} into a new job`}
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/cabin-jobs/new?from=${j.id}`);
                            }}
                          >
                            <Copy size={14} className="mr-1.5" /> Clone
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FinishRequirement({ groups }: { groups: CabinFinishGroup[] }) {
  const totals = useMemo(() => {
    let qty = 0;
    let classified = 0;
    for (const g of groups) {
      qty += g.total_qty;
      if (g.finish !== null) classified += g.total_qty;
    }
    return { finishes: groups.filter((g) => g.finish !== null).length, qty, classified };
  }, [groups]);

  if (groups.length === 0) {
    return (
      <div className="card-surface overflow-hidden">
        <EmptyState
          icon={<Palette size={28} />}
          title="No cabin-job demand yet"
          description="Add items to cabin jobs to see the cumulative requirement by finish."
        />
      </div>
    );
  }

  return (
    <div>
      <StatStrip className="mb-3">
        <StatTile label="Finishes" value={totals.finishes.toLocaleString()} />
        <StatTile label="Total panels" value={totals.qty.toLocaleString()} />
        <StatTile label="Finish recorded" value={`${Math.round((totals.classified / Math.max(1, totals.qty)) * 100)}%`} tone="primary" />
      </StatStrip>

      <div className="card-surface overflow-hidden">
        <Table density="dense">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Finish</TableHead>
              <TableHead className="text-right">Distinct items</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
              <TableHead className="text-right">Total qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <FinishGroupRow key={g.finish ?? "__none__"} group={g} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FinishGroupRow({ group }: { group: CabinFinishGroup }) {
  const [open, setOpen] = useState(false);
  const noFinish = group.finish === null;
  return (
    <>
      <TableRow
        className="cursor-pointer bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70"
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown size={14} className="text-[var(--muted-foreground)]" /> : <ChevronRight size={14} className="text-[var(--muted-foreground)]" />}
            {noFinish ? <span className="text-[var(--muted-foreground)]">(no finish set)</span> : group.finish}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">{group.items.length}</TableCell>
        <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">{group.job_count}</TableCell>
        <TableCell className="text-right font-bold tabular-nums">{group.total_qty.toLocaleString()}</TableCell>
      </TableRow>
      {open &&
        group.items.map((it) => (
          <TableRow key={it.item_id}>
            <TableCell className="pl-8">
              <span className="font-mono text-xs text-[var(--muted-foreground)] mr-1.5">{it.code}</span>
              {it.name}
            </TableCell>
            <TableCell className="text-sm text-[var(--muted-foreground)]" colSpan={2}>{it.cabin_type}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              <CabinJobsPopover itemName={it.name} jobs={it.jobs}>
                <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)]">
                  {it.qty.toLocaleString()}
                </span>
              </CabinJobsPopover>
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

function CategoryRequirement({ groups }: { groups: CabinCategoryGroup[] }) {
  const totals = useMemo(() => {
    let qty = 0;
    let items = 0;
    for (const g of groups) {
      qty += g.total_qty;
      items += g.items.length;
    }
    return { categories: groups.length, qty, items };
  }, [groups]);

  if (groups.length === 0) {
    return (
      <div className="card-surface overflow-hidden">
        <EmptyState
          icon={<Layers size={28} />}
          title="No cabin-job demand yet"
          description="Add items to cabin jobs to see the cumulative requirement by category."
        />
      </div>
    );
  }

  return (
    <div>
      <StatStrip className="mb-3">
        <StatTile label="Categories" value={totals.categories.toLocaleString()} />
        <StatTile label="Distinct items" value={totals.items.toLocaleString()} />
        <StatTile label="Total panels" value={totals.qty.toLocaleString()} tone="primary" />
      </StatStrip>

      <div className="card-surface overflow-hidden">
        <Table density="dense">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Distinct items</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
              <TableHead className="text-right">Total qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <CategoryGroupRow key={g.category} group={g} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CategoryGroupRow({ group }: { group: CabinCategoryGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow
        className="cursor-pointer bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70"
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown size={14} className="text-[var(--muted-foreground)]" /> : <ChevronRight size={14} className="text-[var(--muted-foreground)]" />}
            {group.category}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">{group.items.length}</TableCell>
        <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">{group.job_count}</TableCell>
        <TableCell className="text-right font-bold tabular-nums">{group.total_qty.toLocaleString()}</TableCell>
      </TableRow>
      {open &&
        group.items.map((it) => (
          <TableRow key={it.item_id}>
            <TableCell className="pl-8">
              <span className="font-mono text-xs text-[var(--muted-foreground)] mr-1.5">{it.code}</span>
              {it.name}
            </TableCell>
            <TableCell className="text-sm text-[var(--muted-foreground)]" colSpan={2}>
              {it.finish ?? <span className="italic">(no finish set)</span>}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              <CabinJobsPopover itemName={it.name} jobs={it.jobs}>
                <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)]">
                  {it.qty.toLocaleString()}
                </span>
              </CabinJobsPopover>
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

function WeeklyRequirement({
  plan,
  cumulative,
  onCumulative,
  finish,
  onFinish,
}: {
  plan: CabinWeeklyPlan;
  cumulative: boolean;
  onCumulative: (v: boolean) => void;
  finish: string;
  onFinish: (v: string) => void;
}) {
  const finishes = useMemo(
    () => [...new Set(plan.rows.map((r) => r.finish ?? "(no finish)"))].sort(),
    [plan.rows],
  );

  // Map weekly demand into the shared matrix shape: grouped by cabin category
  // (r.type), with the finish carried as `sub` so the matrix sorts each category's
  // parts by finish (rowSort="sub").
  const rows = useMemo<MatrixRow[]>(
    () =>
      plan.rows
        .filter((r) => finish === "all" || (r.finish ?? "(no finish)") === finish)
        .map((r) => ({
          id: r.item_id,
          code: r.code,
          name: r.name,
          category: r.type,
          perWeek: r.perWeek,
          cumulative: r.cumulative,
          sub: r.finish ?? "(no finish)",
        })),
    [plan.rows, finish],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Select
          size="sm"
          value={finish}
          onChange={(e) => onFinish(e.target.value)}
          className="w-[200px]"
          title="Filter by finish"
        >
          <option value="all">All finishes</option>
          {finishes.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
        <CumulativeToggle cumulative={cumulative} onChange={onCumulative} />
      </div>

      <WeeklyMatrix
        weeks={plan.weeks}
        rows={rows}
        aggregate="count"
        unit="items"
        cumulative={cumulative}
        rowSort="sub"
        emptyLabel="No cabin demand falls in the next 8 weeks."
      />

      {(plan.laterCount > 0 || plan.undatedCount > 0) && (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Not planned here:{" "}
          {plan.laterCount > 0 && (
            <>
              <strong className="text-[var(--foreground)]">{plan.laterCount}</strong> cabin job{plan.laterCount === 1 ? "" : "s"} due after 8 weeks
            </>
          )}
          {plan.laterCount > 0 && plan.undatedCount > 0 && " · "}
          {plan.undatedCount > 0 && (
            <>
              <strong className="text-[var(--foreground)]">{plan.undatedCount}</strong> with no linked-job date
            </>
          )}
          .
        </p>
      )}

      <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
        Each column is a week (dated from each cabin job&rsquo;s linked elevator job). Cells count distinct parts — click a category to see every part by finish, week by week.
      </p>
    </div>
  );
}
