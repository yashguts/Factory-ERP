"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { Plus, Search, ClipboardCheck, Copy, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { CabinJobListRow } from "@/lib/actions/cabin-jobs";

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

export function CabinJobsClient({ jobs }: { jobs: CabinJobListRow[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [systemFilter, setSystemFilter] = useState<string>(() => readParam(sp, "sys", "all"));
  const [materialFilter, setMaterialFilter] = useState<string>(() => readParam(sp, "mat", "all"));
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "created", ["job_number", "platform", "side_panel", "items", "created"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "desc", ["asc", "desc"]) as SortDir,
  );

  useUrlListSync(
    { q: search, sys: systemFilter, mat: materialFilter, sort: sortKey, dir: sortDir },
    { q: "", sys: "all", mat: "all", sort: "created", dir: "desc" },
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
          filtersActive
            ? `${sorted.length} of ${jobs.length} cabin job${jobs.length === 1 ? "" : "s"}`
            : `${jobs.length} cabin job${jobs.length === 1 ? "" : "s"}`
        }
        actions={
          <Button size="sm" onClick={() => router.push("/cabin-jobs/new")}>
            <Plus size={16} className="mr-1.5" /> New Cabin Job
          </Button>
        }
      />

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
                  className="cursor-pointer hover:bg-[var(--muted)]"
                  onClick={() => router.push(`/cabin-jobs/${j.id}`)}
                >
                  <TableCell className="font-mono font-medium">{j.job_number}</TableCell>
                  <TableCell>{j.customer_name || "—"}</TableCell>
                  <TableCell className="font-mono text-[13px]">{j.platform || "—"}</TableCell>
                  <TableCell>{j.side_panel_material || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.line_count}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">
                    {new Date(j.created_at).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      title={`Clone ${j.job_number} into a new job`}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/cabin-jobs/new?from=${j.id}`);
                      }}
                    >
                      <Copy size={14} className="mr-1.5" /> Clone
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
