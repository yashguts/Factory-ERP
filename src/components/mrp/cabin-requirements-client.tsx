"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Search, LayoutGrid, ChevronDown, ChevronRight } from "lucide-react";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { CabinScopePicker } from "@/components/mrp/cabin-scope-picker";
import { CabinItemJobsPopover } from "@/components/mrp/cabin-item-jobs-popover";
import type { CabinReqRow } from "@/lib/actions/cabin-program-plan";
import type { CabinScopeData } from "@/lib/actions/job-sets";

type ShowFilter = "shortfall" | "all";

export function CabinRequirementsClient({
  rows,
  scope,
}: {
  rows: CabinReqRow[];
  scope: CabinScopeData;
}) {
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [show, setShow] = useState<ShowFilter>(() => readParam(sp, "show", "shortfall", ["shortfall", "all"]) as ShowFilter);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useUrlListSync({ q: search, show }, { q: "", show: "shortfall" });

  // The scope the table was computed for — the Required-cell hover must ask
  // for the same scope so its per-job split sums to the number shown. Use the
  // server-resolved scope (covers both ?jobs= and saved-set ?set= modes); for
  // a set matching 0 cabin jobs, mirror the server's NIL sentinel so the
  // popover can't fall back to the all-eligible-jobs default.
  const jobIds = useMemo(
    () =>
      scope.activeSet && scope.selectedIds.length === 0
        ? ["00000000-0000-0000-0000-000000000000"]
        : scope.selectedIds,
    [scope],
  );

  const tokens = useMemo(() => search.trim().toLowerCase().split(/\s+/).filter(Boolean), [search]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (show === "shortfall" && r.shortfall <= 0) return false;
      if (tokens.length) {
        const hay = `${r.code} ${r.name} ${r.type} ${r.finish ?? ""}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [rows, show, tokens]);

  const stats = useMemo(() => {
    let short = 0, inStock = 0;
    for (const r of rows) {
      if (r.shortfall > 0) short++;
      else inStock++;
    }
    return { demanded: rows.length, short, inStock };
  }, [rows]);

  // type -> finish -> rows
  const groups = useMemo(() => {
    const byType = new Map<string, Map<string, CabinReqRow[]>>();
    for (const r of filtered) {
      const fin = r.finish ?? "(no finish)";
      const byFin = byType.get(r.type) ?? new Map<string, CabinReqRow[]>();
      const arr = byFin.get(fin) ?? [];
      arr.push(r);
      byFin.set(fin, arr);
      byType.set(r.type, byFin);
    }
    return [...byType.entries()]
      .map(([type, byFin]) => {
        const finishes = [...byFin.entries()]
          .map(([finish, items]) => {
            items.sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name));
            return { finish, items, shortfall: items.reduce((s, r) => s + r.shortfall, 0) };
          })
          .sort((a, b) => b.shortfall - a.shortfall || a.finish.localeCompare(b.finish));
        const shortfall = finishes.reduce((s, f) => s + f.shortfall, 0);
        const count = finishes.reduce((s, f) => s + f.items.length, 0);
        return { type, finishes, shortfall, count };
      })
      .sort((a, b) => b.shortfall - a.shortfall || a.type.localeCompare(b.type));
  }, [filtered]);

  const toggle = (type: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <div>
      <MrpToolbar view="requirements" date="" section="cabin" />
      <CabinScopePicker scope={scope} />

      <PageHeader
        icon={<LayoutGrid size={18} />}
        title="Cabin MRP — Requirements"
        meta="Cabin-job demand by type and finish, netted against stock"
      />

      <StatStrip className="mb-3">
        <StatTile label="Items demanded" value={stats.demanded.toLocaleString()} />
        <StatTile label="In stock" value={stats.inStock.toLocaleString()} tone="ok" />
        <StatTile label="Short" value={stats.short.toLocaleString()} tone="danger" />
      </StatStrip>

      <Toolbar>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input size="sm" placeholder="Search code, name, type, finish…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select size="sm" value={show} onChange={(e) => setShow(e.target.value as ShowFilter)} className="w-[150px]">
          <option value="shortfall">Only short</option>
          <option value="all">All items</option>
        </Select>
      </Toolbar>

      {groups.length === 0 ? (
        <div className="card-surface overflow-hidden">
          <EmptyState
            icon={<LayoutGrid size={28} />}
            title={rows.length === 0 ? "No cabin-job demand yet" : show === "shortfall" ? "Nothing short — covered by stock" : "No items match your search"}
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Required</TableHead>
                <TableHead className="text-right">In Stock</TableHead>
                <TableHead className="text-right">Shortfall</TableHead>
                <TableHead className="text-right">Jobs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const open = !collapsed.has(g.type);
                return (
                  <CabinTypeGroup key={g.type} group={g} open={open} onToggle={() => toggle(g.type)} jobIds={jobIds} />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CabinTypeGroup({
  group,
  open,
  onToggle,
  jobIds,
}: {
  group: { type: string; finishes: { finish: string; items: CabinReqRow[]; shortfall: number }[]; shortfall: number; count: number };
  open: boolean;
  onToggle: () => void;
  jobIds: string[];
}) {
  return (
    <>
      <TableRow className="cursor-pointer bg-[var(--muted)]/50 hover:bg-[var(--muted)]/70" onClick={onToggle}>
        <TableCell colSpan={5} className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown size={14} className="text-[var(--muted-foreground)]" /> : <ChevronRight size={14} className="text-[var(--muted-foreground)]" />}
            {group.type}
            <span className="text-[var(--muted-foreground)] font-normal">· {group.count} item{group.count === 1 ? "" : "s"} · {group.finishes.length} finish{group.finishes.length === 1 ? "" : "es"}</span>
          </span>
        </TableCell>
        <TableCell className="text-right font-medium text-[var(--destructive)]">{group.shortfall > 0 ? group.shortfall.toLocaleString() : <span className="text-[var(--muted-foreground)]">—</span>}</TableCell>
      </TableRow>
      {open &&
        group.finishes.map((f) => (
          <FinishRows key={f.finish} type={group.type} finish={f.finish} items={f.items} shortfall={f.shortfall} jobIds={jobIds} />
        ))}
    </>
  );
}

function FinishRows({ type, finish, items, shortfall, jobIds }: { type: string; finish: string; items: CabinReqRow[]; shortfall: number; jobIds: string[] }) {
  return (
    <>
      <TableRow className="bg-[var(--muted)]/20">
        <TableCell colSpan={5} className="pl-8 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
          {finish}
        </TableCell>
        <TableCell className="text-right text-xs text-[var(--muted-foreground)]">{shortfall > 0 ? shortfall.toLocaleString() : "—"}</TableCell>
      </TableRow>
      {items.map((r) => (
        <TableRow key={r.item_id}>
          <TableCell className="font-mono text-xs pl-8">{r.code}</TableCell>
          <TableCell><div className="font-medium">{r.name}</div></TableCell>
          <TableCell className="text-right">
            <CabinItemJobsPopover itemId={r.item_id} itemName={r.name} jobIds={jobIds}>
              <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)]">
                {r.required.toLocaleString()}
              </span>
            </CabinItemJobsPopover>
          </TableCell>
          <TableCell className="text-right">{r.stock.toLocaleString()}</TableCell>
          <TableCell className="text-right font-bold">
            {r.shortfall > 0 ? <span className="text-[var(--destructive)]">-{r.shortfall.toLocaleString()}</span> : <span className="text-[var(--success)]">+{(r.stock - r.required).toLocaleString()}</span>}
          </TableCell>
          <TableCell className="text-right text-sm text-[var(--muted-foreground)]">{r.job_count}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
