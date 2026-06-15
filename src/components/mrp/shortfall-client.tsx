"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Search, X, PackageSearch, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MrpRow } from "@/lib/actions/mrp";

interface PickJob {
  id: string;
  number: string;
  customer: string | null;
  location: string | null;
  status: string;
  date: string | null;
}

const UNCATEGORISED = "Uncategorised";
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

export function ShortfallClient({
  jobs,
  selected,
  rows,
}: {
  jobs: PickJob[];
  selected: string[];
  rows: MrpRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sel, setSel] = useState<Set<string>>(() => new Set(selected));
  const [search, setSearch] = useState("");

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const dirty = useMemo(() => {
    if (sel.size !== selectedSet.size) return true;
    for (const id of sel) if (!selectedSet.has(id)) return true;
    return false;
  }, [sel, selectedSet]);

  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleJobs = useMemo(() => {
    if (tokens.length === 0) return jobs;
    return jobs.filter((j) => {
      const hay = [j.number, j.customer, j.location, j.status].filter(Boolean).join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [jobs, tokens]);

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () =>
    startTransition(() => {
      const ids = [...sel];
      router.push(ids.length ? `/mrp/shortfall?jobs=${ids.join(",")}` : "/mrp/shortfall");
    });

  const clear = () => setSel(new Set());

  return (
    <div>
      <PageHeader
        title="Job shortfall"
        meta="Pick a job or a set of jobs to see their combined make + trade shortfall"
      />

      {/* Picker */}
      <div className="card-surface p-3 mb-5">
        {/* Selected pills */}
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            {[...sel].map((id) => {
              const j = jobById.get(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/50 pl-2 pr-1 py-0.5 text-xs"
                >
                  <span className="font-medium">{j?.number ?? id.slice(0, 6)}</span>
                  {j?.customer && <span className="text-[var(--muted-foreground)]">· {j.customer}</span>}
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="ml-0.5 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
                    aria-label="Remove job"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={clear}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              size="sm"
              placeholder="Search job number, customer, location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button size="sm" onClick={apply} disabled={!dirty || isPending}>
            {isPending ? "Computing…" : sel.size === 0 ? "Clear results" : `Show shortfall (${sel.size})`}
          </Button>
        </div>

        {/* Job checklist */}
        <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--border)]">
          {visibleJobs.length === 0 ? (
            <div className="p-3 text-sm text-[var(--muted-foreground)]">No jobs match your search.</div>
          ) : (
            visibleJobs.map((j) => {
              const checked = sel.has(j.id);
              return (
                <label
                  key={j.id}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/40",
                    checked && "bg-[var(--primary)]/5",
                  )}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(j.id)} className="cursor-pointer" />
                  <span className="font-medium w-28 shrink-0 truncate">{j.number}</span>
                  <span className="flex-1 truncate text-[var(--muted-foreground)]">{j.customer ?? "—"}</span>
                  <span className="hidden sm:inline text-xs text-[var(--muted-foreground)] w-20 shrink-0 truncate">{j.location ?? ""}</span>
                  <span className="text-xs text-[var(--muted-foreground)] w-14 shrink-0 text-right">{fmtDate(j.date)}</span>
                </label>
              );
            })
          )}
        </div>
      </div>

      {/* Results */}
      {dirty && (
        <p className="mb-3 text-xs text-[var(--warning)]">
          Selection changed — click &ldquo;Show shortfall&rdquo; to recompute.
        </p>
      )}
      <Results rows={rows} hasSelection={selected.length > 0} />
    </div>
  );
}

function Results({ rows, hasSelection }: { rows: MrpRow[]; hasSelection: boolean }) {
  const make = useMemo(() => rows.filter((r) => r.procurement_type === "make" && r.shortfall > 0), [rows]);
  const trade = useMemo(() => rows.filter((r) => r.procurement_type === "trade" && r.shortfall > 0), [rows]);

  if (!hasSelection) {
    return (
      <div className="card-surface overflow-hidden">
        <EmptyState icon={<PackageSearch size={28} />} title="Pick jobs above to see their combined shortfall" />
      </div>
    );
  }

  if (make.length === 0 && trade.length === 0) {
    return (
      <div className="card-surface overflow-hidden">
        <EmptyState
          icon={<PackageSearch size={28} />}
          title="No shortfall for these jobs"
          description="Everything these jobs need is covered by current stock."
        />
      </div>
    );
  }

  const makeShort = make.reduce((s, r) => s + r.shortfall, 0);
  const tradeShort = trade.reduce((s, r) => s + r.shortfall, 0);

  return (
    <div className="space-y-5">
      <StatStrip>
        <StatTile label="Items short" value={(make.length + trade.length).toLocaleString()} tone="danger" />
        <StatTile label="Make to manufacture" value={make.length.toLocaleString()} />
        <StatTile label="Trade to buy" value={trade.length.toLocaleString()} />
      </StatStrip>

      {make.length > 0 && <ResultSection title="Make · to manufacture" rows={make} />}
      {trade.length > 0 && <ResultSection title="Trade · to buy" rows={trade} />}
    </div>
  );
}

function ResultSection({ title, rows }: { title: string; rows: MrpRow[] }) {
  const groups = useMemo(() => {
    const byCat = new Map<string, MrpRow[]>();
    for (const r of rows) {
      const k = r.top_category_name ?? UNCATEGORISED;
      const arr = byCat.get(k);
      if (arr) arr.push(r);
      else byCat.set(k, [r]);
    }
    return Array.from(byCat.entries())
      .map(([name, catRows]) => {
        catRows.sort((a, b) => b.shortfall - a.shortfall);
        return { name, rows: catRows, shortfall: catRows.reduce((s, r) => s + r.shortfall, 0) };
      })
      .sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name));
  }, [rows]);

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2">{title} <span className="font-normal text-[var(--muted-foreground)]">· {rows.length} items</span></h2>
      <div className="card-surface overflow-hidden">
        <Table density="dense">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Item Name</TableHead>
              <TableHead className="text-right">Required</TableHead>
              <TableHead className="text-right">In Stock</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <CatGroup key={g.name} group={g} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CatGroup({ group }: { group: { name: string; rows: MrpRow[]; shortfall: number } }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <TableRow
        className="cursor-pointer bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70"
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell colSpan={4} className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown size={14} className="text-[var(--muted-foreground)]" /> : <ChevronRight size={14} className="text-[var(--muted-foreground)]" />}
            {group.name}
            <span className="text-[var(--muted-foreground)] font-normal">· {group.rows.length}</span>
          </span>
        </TableCell>
        <TableCell className="text-right font-medium text-[var(--destructive)]">
          {group.shortfall.toLocaleString()}
        </TableCell>
      </TableRow>
      {open &&
        group.rows.map((r) => (
          <TableRow key={r.item_id}>
            <TableCell className="font-mono text-xs">{r.item_code}</TableCell>
            <TableCell><div className="font-medium">{r.item_name}</div></TableCell>
            <TableCell className="text-right">
              {r.total_required.toLocaleString()} <span className="text-xs text-[var(--muted-foreground)]">{r.uom_abbreviation}</span>
            </TableCell>
            <TableCell className="text-right">
              {r.total_stock.toLocaleString()} <span className="text-xs text-[var(--muted-foreground)]">{r.uom_abbreviation}</span>
            </TableCell>
            <TableCell className="text-right font-bold text-[var(--destructive)]">
              -{r.shortfall.toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
