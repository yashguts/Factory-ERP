"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { ExportButton } from "@/components/ui/export-button";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Search, Calculator, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { JobScopePicker } from "@/components/mrp/job-scope-picker";
import type { MrpRow, PlanLeaf, JobScopeOption } from "@/lib/actions/mrp";
import { MrpJobsPopover } from "@/components/mrp/mrp-jobs-popover";

type ShortfallFilter = "shortfall" | "all" | "excess";

/** Group key used for the exploded steel sheets (one group, regardless of each
 *  sheet's real top-level category). */
const SHEET_GROUP = "Raw steel / sheets";
const UNCATEGORISED = "Uncategorised";

interface Props {
  initialData: MrpRow[];
  initialCutoffDate?: string;
  /**
   * The page is locked to one procurement side (its own sidebar section). Drives
   * the title and whether PO columns / the sheets group show.
   */
  section?: "make" | "trade";
  /**
   * Trade only: exploded raw steel / sheets to buy (from getProductionPlan), folded
   * in as a "Raw steel / sheets" category group so the buy list is complete on one
   * page. These never appear on a job BOM, so they're shown but carry no job links.
   */
  sheets?: PlanLeaf[];
  /** Job Orders for the scope picker (?jobs=). Absent = no picker rendered. */
  scopeOptions?: JobScopeOption[];
}

/** Unified display row — a trade/make item or an exploded sheet. */
type ViewRow = {
  item_id: string;
  item_code: string;
  item_name: string;
  category_name: string | null;
  group: string;
  uom: string | null;
  total_required: number;
  total_stock: number;
  shortfall: number;
  on_order: number;
  to_buy: number;
  job_count: number;
  is_sheet: boolean;
};

export function MrpClient({ initialData, initialCutoffDate, section, sheets, scopeOptions }: Props) {
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [shortfallFilter, setShortfallFilter] = useState<ShortfallFilter>(
    () => readParam(sp, "show", "shortfall", ["shortfall", "all", "excess"]) as ShortfallFilter,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const cutoffDate = initialCutoffDate ?? "";
  const isTrade = section === "trade";
  // On-order / To-buy (outstanding-PO netting) only matters for purchased Trade
  // items; the Make side never has POs.
  const showPo = section !== "make";

  useUrlListSync(
    { q: search, show: shortfallFilter },
    { q: "", show: "shortfall" },
  );

  // Scope to the page's procurement side, then fold the sheets in (trade only).
  const viewRows = useMemo<ViewRow[]>(() => {
    const out: ViewRow[] = [];
    const seen = new Set<string>();
    for (const r of initialData) {
      if (section && r.procurement_type !== section) continue;
      seen.add(r.item_id);
      out.push({
        item_id: r.item_id,
        item_code: r.item_code,
        item_name: r.item_name,
        category_name: r.category_name,
        group: r.top_category_name ?? UNCATEGORISED,
        uom: r.uom_abbreviation,
        total_required: r.total_required,
        total_stock: r.total_stock,
        shortfall: r.shortfall,
        on_order: r.on_order,
        to_buy: r.to_buy,
        job_count: r.job_count,
        is_sheet: false,
      });
    }
    if (isTrade && sheets) {
      for (const s of sheets) {
        // A sheet shown here must not also appear as a trade row.
        if (seen.has(s.item_id)) continue;
        out.push({
          item_id: s.item_id,
          item_code: s.code,
          item_name: s.name,
          category_name: s.subCategory,
          // Group exploded sheets under their real top-level category (e.g. "MS
          // Sheet/Plate", "SS Sheet") so they sit alongside the rest of the buy
          // list by category, matching how Inventory is browsed.
          group: s.category && s.category !== "(none)" ? s.category : UNCATEGORISED,
          uom: s.uom,
          total_required: s.qty,
          total_stock: s.in_stock,
          shortfall: s.shortfall,
          on_order: 0,
          to_buy: s.shortfall,
          job_count: 0,
          is_sheet: true,
        });
      }
    }
    return out;
  }, [initialData, section, isTrade, sheets]);

  const searchTokens = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const filtered = useMemo(() => {
    return viewRows.filter((row) => {
      if (searchTokens.length > 0) {
        const haystack = [row.item_code, row.item_name, row.category_name, row.group]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        for (const token of searchTokens) if (!haystack.includes(token)) return false;
      }
      // Owner's rule: items without a shortfall are hidden by default. Items WITH a
      // shortfall stay even when a PO fully covers them (shortfall>0 already).
      if (shortfallFilter === "shortfall" && row.shortfall <= 0) return false;
      if (shortfallFilter === "excess" && row.total_stock <= row.total_required) return false;
      return true;
    });
  }, [viewRows, searchTokens, shortfallFilter]);

  // Group by top-level category. Categories ordered by total shortfall desc (most
  // urgent first); the steel-sheets group is always pinned last (different axis).
  const groups = useMemo(() => {
    const byGroup = new Map<string, ViewRow[]>();
    for (const r of filtered) {
      const arr = byGroup.get(r.group) ?? [];
      arr.push(r);
      byGroup.set(r.group, arr);
    }
    const list = Array.from(byGroup.entries()).map(([name, rows]) => {
      rows.sort((a, b) => b.shortfall - a.shortfall || b.to_buy - a.to_buy);
      return {
        name,
        rows,
        shortfall: rows.reduce((s, r) => s + r.shortfall, 0),
        toBuy: rows.reduce((s, r) => s + r.to_buy, 0),
      };
    });
    list.sort((a, b) => {
      if (a.name === SHEET_GROUP) return 1;
      if (b.name === SHEET_GROUP) return -1;
      return b.shortfall - a.shortfall || a.name.localeCompare(b.name);
    });
    return list;
  }, [filtered]);

  const stats = useMemo(() => {
    let itemsShort = 0;
    let coveredByPo = 0;
    for (const r of viewRows) {
      if (r.shortfall > 0) {
        itemsShort++;
        if (r.to_buy <= 0) coveredByPo++;
      }
    }
    return { itemsShort, coveredByPo, shown: filtered.length };
  }, [viewRows, filtered]);

  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const title = isTrade
    ? "Trade MRP — what to buy"
    : section === "make"
      ? "Make MRP — Requirements"
      : "MRP — Material Requirements";

  // Column count for the group-header colspan.
  const colCount = isTrade ? 7 : 6;

  return (
    <div>
      <MrpToolbar view="requirements" date={cutoffDate} section={section} />
      {scopeOptions && <JobScopePicker options={scopeOptions} />}

      <PageHeader
        title={title}
        meta={
          <>
            {isTrade ? "By category · only items short or on order" : "By category"}
            {cutoffDate &&
              ` — up to ${new Date(cutoffDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
          </>
        }
      />

      <StatStrip className="mb-3">
        <StatTile label={isTrade ? "Items to buy" : "Items to make"} value={stats.shown.toLocaleString()} />
        <StatTile label="Short" value={stats.itemsShort.toLocaleString()} tone="danger" />
        {isTrade && <StatTile label="Covered by PO" value={stats.coveredByPo.toLocaleString()} tone="primary" />}
      </StatStrip>

      <Toolbar>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search code, name, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          size="sm"
          value={shortfallFilter}
          onChange={(e) => setShortfallFilter(e.target.value as ShortfallFilter)}
          className="w-[160px]"
        >
          <option value="shortfall">Only short</option>
          <option value="all">All items</option>
          <option value="excess">Sufficient only</option>
        </Select>
        <ToolbarSpacer />
        <ExportButton
          rows={filtered}
          filename={`mrp-${section ?? "all"}-requirements`}
          sheetName="MRP"
          columns={[
            { header: "Category", field: "group" },
            { header: "Code", field: "item_code" },
            { header: "Item", field: "item_name" },
            { header: "Sub-category", field: "category_name" },
            { header: "UOM", field: "uom" },
            { header: "Required", field: "total_required" },
            { header: "In Stock", field: "total_stock" },
            { header: "Shortfall", field: "shortfall" },
            { header: "On order", field: "on_order" },
            { header: "To buy", field: "to_buy" },
            { header: "Jobs", field: "job_count" },
          ]}
        />
      </Toolbar>

      {filtered.length === 0 ? (
        <div className="card-surface overflow-hidden">
          <EmptyState
            icon={<Calculator size={28} />}
            title={
              viewRows.length === 0
                ? "No material requirements found"
                : shortfallFilter === "shortfall"
                  ? "Nothing short — everything is covered"
                  : "No items match your filters"
            }
            description={
              viewRows.length === 0 ? "Ensure jobs have BOM lines with mapped items." : undefined
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead className="text-right">Required</TableHead>
                <TableHead className="text-right">In Stock</TableHead>
                {!isTrade && <TableHead className="text-right">Shortfall</TableHead>}
                {showPo && <TableHead className="text-right" title="On order — outstanding purchase-order qty not yet received">On order</TableHead>}
                {showPo && <TableHead className="text-right" title="To buy — net still to procure after subtracting open POs">To buy</TableHead>}
                <TableHead className="text-right">Jobs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.name);
                const isSheetGroup = g.name === SHEET_GROUP;
                return (
                  <GroupRows
                    key={g.name}
                    group={g}
                    isCollapsed={isCollapsed}
                    isSheetGroup={isSheetGroup}
                    isTrade={isTrade}
                    showPo={showPo}
                    colCount={colCount}
                    cutoffDate={cutoffDate}
                    onToggle={() => toggle(g.name)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function GroupRows({
  group,
  isCollapsed,
  isSheetGroup,
  isTrade,
  showPo,
  colCount,
  cutoffDate,
  onToggle,
}: {
  group: { name: string; rows: ViewRow[]; shortfall: number; toBuy: number };
  isCollapsed: boolean;
  isSheetGroup: boolean;
  isTrade: boolean;
  showPo: boolean;
  colCount: number;
  cutoffDate: string;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Category header row — click to collapse / expand */}
      <TableRow
        className="cursor-pointer bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70 transition-colors"
        onClick={onToggle}
      >
        <TableCell colSpan={colCount - 1} className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            {isCollapsed ? (
              <ChevronRight size={14} className="text-[var(--muted-foreground)]" />
            ) : (
              <ChevronDown size={14} className="text-[var(--muted-foreground)]" />
            )}
            {isSheetGroup && <Layers size={14} className="text-[var(--muted-foreground)]" />}
            {group.name}
            <span className="text-[var(--muted-foreground)] font-normal">
              · {group.rows.length} {group.rows.length === 1 ? "item" : "items"}
              {isSheetGroup && " · from programs"}
            </span>
          </span>
        </TableCell>
        <TableCell className="text-right font-medium">
          {group.shortfall > 0 ? (
            <span className="text-[var(--destructive)]">{group.shortfall.toLocaleString()}</span>
          ) : (
            <span className="text-[var(--muted-foreground)]">—</span>
          )}
        </TableCell>
      </TableRow>

      {!isCollapsed &&
        group.rows.map((row) => (
          <TableRow key={`${isSheetGroup ? "sheet-" : ""}${row.item_id}`}>
            <TableCell className="font-mono text-xs">{row.item_code}</TableCell>
            <TableCell>
              <div className="font-medium">{row.item_name}</div>
            </TableCell>
            <TableCell className="text-right font-medium">
              {row.total_required.toLocaleString()}{" "}
              <span className="text-xs text-[var(--muted-foreground)]">{row.uom}</span>
            </TableCell>
            <TableCell className="text-right font-medium">
              {row.total_stock.toLocaleString()}{" "}
              <span className="text-xs text-[var(--muted-foreground)]">{row.uom}</span>
            </TableCell>
            {!isTrade && (
              <TableCell className="text-right font-bold">
                {row.shortfall > 0 ? (
                  <span className="text-[var(--destructive)]">-{row.shortfall.toLocaleString()}</span>
                ) : (
                  <span className="text-[var(--success)]">+{(row.total_stock - row.total_required).toLocaleString()}</span>
                )}
              </TableCell>
            )}
            {showPo && (
              <TableCell className="text-right">
                {row.on_order > 0 ? (
                  <span className="text-[var(--primary)] font-medium">{row.on_order.toLocaleString()}</span>
                ) : (
                  <span className="text-[var(--muted-foreground)]">—</span>
                )}
              </TableCell>
            )}
            {showPo && (
              <TableCell className="text-right font-medium">
                {row.shortfall === 0 ? (
                  <span className="text-[var(--muted-foreground)]">—</span>
                ) : row.to_buy > 0 ? (
                  <span className="text-[var(--destructive)]">{row.to_buy.toLocaleString()}</span>
                ) : (
                  <Badge variant="blue" title="Shortfall is fully covered by an open PO">on order</Badge>
                )}
              </TableCell>
            )}
            <TableCell className="text-right text-sm">
              {row.is_sheet ? (
                <span className="text-[var(--muted-foreground)]">—</span>
              ) : row.total_required > 0 ? (
                <MrpJobsPopover
                  itemId={row.item_id}
                  itemName={row.item_name}
                  uom={row.uom}
                  cutoffDate={cutoffDate || undefined}
                >
                  <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)]">
                    {row.job_count}
                  </span>
                </MrpJobsPopover>
              ) : (
                row.job_count
              )}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
