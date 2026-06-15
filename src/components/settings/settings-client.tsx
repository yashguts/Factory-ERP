"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Search, PackageX, GitBranch, ChevronLeft, ChevronRight } from "lucide-react";
import type { OverstockRow, DemandRulesDoc } from "@/lib/actions/settings";

type Tab = "overstock" | "rules";
type StockShow = "all" | "demand" | "dead";
const PAGE_SIZE = 100;

export function SettingsClient({
  overstock,
  rules,
}: {
  overstock: OverstockRow[];
  rules: DemandRulesDoc;
}) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => readParam(sp, "tab", "overstock", ["overstock", "rules"]) as Tab);
  useUrlListSync({ tab }, { tab: "overstock" });

  return (
    <div>
      <PageHeader title="Settings" meta="Overstock report and the rules that drive demand" />

      <Tabs
        variant="underline"
        className="mb-4"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "overstock", label: "Overstocked items", count: overstock.length },
          { value: "rules", label: "Demand rules", count: rules.componentRuleCount + rules.driveRules.length },
        ]}
      />

      {tab === "overstock" ? <OverstockTab rows={overstock} /> : <RulesTab rules={rules} />}
    </div>
  );
}

function OverstockTab({ rows }: { rows: OverstockRow[] }) {
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [show, setShow] = useState<StockShow>(() => readParam(sp, "show", "all", ["all", "demand", "dead"]) as StockShow);
  const [page, setPage] = useState(1);
  useUrlListSync({ tab: "overstock", q: search, show }, { tab: "overstock", q: "", show: "all" });

  const tokens = useMemo(() => search.trim().toLowerCase().split(/\s+/).filter(Boolean), [search]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (show === "demand" && !r.has_demand) return false;
      if (show === "dead" && r.has_demand) return false;
      if (tokens.length > 0) {
        const hay = [r.code, r.name, r.category_name].filter(Boolean).join(" ").toLowerCase();
        for (const t of tokens) if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, show, tokens]);

  const counts = useMemo(() => {
    let withDemand = 0;
    for (const r of rows) if (r.has_demand) withDemand++;
    return { total: rows.length, withDemand, dead: rows.length - withDemand };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  return (
    <div>
      <StatStrip className="mb-3">
        <StatTile label="Overstocked items" value={counts.total.toLocaleString()} />
        <StatTile label="Needed by jobs" value={counts.withDemand.toLocaleString()} tone="primary" />
        <StatTile label="No current demand" value={counts.dead.toLocaleString()} tone="warn" />
      </StatStrip>

      <Toolbar>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search code, name, category..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8"
          />
        </div>
        <Select size="sm" value={show} onChange={(e) => { setShow(e.target.value as StockShow); setPage(1); }} className="w-[200px]">
          <option value="all">All overstocked</option>
          <option value="demand">Needed by jobs</option>
          <option value="dead">No current demand</option>
        </Select>
      </Toolbar>

      {paged.length === 0 ? (
        <div className="card-surface overflow-hidden">
          <EmptyState
            icon={<PackageX size={28} />}
            title={rows.length === 0 ? "Nothing is overstocked" : "No items match your filters"}
            description={rows.length === 0 ? "Stock is at or below requirement everywhere." : undefined}
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>M/T</TableHead>
                <TableHead className="text-right">In Stock</TableHead>
                <TableHead className="text-right">Required</TableHead>
                <TableHead className="text-right" title="In stock minus current requirement">Excess</TableHead>
                <TableHead className="text-right" title="In stock ÷ requirement">×</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((r) => (
                <TableRow key={r.item_id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell><div className="font-medium">{r.name}</div></TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">{r.category_name ?? "—"}</TableCell>
                  <TableCell>
                    {r.procurement_type ? (
                      <Badge variant={r.procurement_type === "make" ? "amber" : "blue"}>
                        {r.procurement_type === "make" ? "Make" : "Trade"}
                      </Badge>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {r.in_stock.toLocaleString()} <span className="text-xs text-[var(--muted-foreground)]">{r.uom}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.has_demand ? r.required.toLocaleString() : <span className="text-[var(--muted-foreground)]">0</span>}
                  </TableCell>
                  <TableCell className="text-right font-bold text-[var(--warning)]">
                    +{r.excess.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-sm text-[var(--muted-foreground)]">
                    {r.ratio != null ? `${r.ratio >= 100 ? Math.round(r.ratio) : (Math.round(r.ratio * 10) / 10)}×` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage(pageSafe - 1)} disabled={pageSafe === 1}>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-sm font-medium">{pageSafe} / {totalPages}</span>
            <Button variant="secondary" size="sm" onClick={() => setPage(pageSafe + 1)} disabled={pageSafe === totalPages}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RulesTab({ rules }: { rules: DemandRulesDoc }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted-foreground)] max-w-2xl">
        These rules let MRP demand parts that aren&apos;t written on a job&apos;s BOM directly. They&apos;re
        applied automatically every time requirements are computed. This page is the single place to
        see what the system adds and why.
      </p>

      {/* Component rules — child demanded per demanded parent */}
      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <GitBranch size={16} className="text-[var(--primary)]" />
          Component rules
          <span className="font-normal text-[var(--muted-foreground)]">
            · {rules.componentRuleCount.toLocaleString()} rules
          </span>
        </h2>
        {rules.componentFamilies.length === 0 ? (
          <Card><EmptyState icon={<GitBranch size={24} />} title="No component rules defined" /></Card>
        ) : (
          <div className="space-y-3">
            {rules.componentFamilies.map((fam) => (
              <Card key={fam.note}>
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-sm font-medium capitalize">{fam.note}</h3>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {fam.parent_count.toLocaleString()} parent {fam.parent_count === 1 ? "item" : "items"}
                  </span>
                </div>
                <p className="text-xs text-[var(--muted-foreground)] mb-2">
                  When a job needs one of these parts, MRP also demands:
                </p>
                <ul className="space-y-1.5">
                  {fam.lines.map((l) => (
                    <li key={`${l.child_code}-${l.qty}`} className="text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-medium text-[var(--foreground)]">{l.qty} ×</span>
                        <span className="font-mono text-xs text-[var(--muted-foreground)]">{l.child_code}</span>
                        <span>{l.child_name}</span>
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {" — "}per parent, for {l.parent_count.toLocaleString()} of them
                        {l.example_parents.length > 0 && (
                          <> (e.g. {l.example_parents.map((p) => p.code).join(", ")})</>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Drive-type rules */}
      {rules.driveRules.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Drive-type rules</h2>
          <Card>
            <p className="text-xs text-[var(--muted-foreground)] mb-2">
              Parts a lift needs based on the job&apos;s drive type (not via the BOM). Counted once per
              matching in-production job.
            </p>
            <ul className="space-y-1.5">
              {rules.driveRules.map((r) => (
                <li key={r.code} className="text-sm">
                  <span className="font-medium">Every {r.drive_types.join(" or ")} job</span>
                  {" → "}
                  <span className="font-medium text-[var(--foreground)]">{r.qty_per_job} ×</span>{" "}
                  <span className="font-mono text-xs text-[var(--muted-foreground)]">{r.code}</span> {r.name}
                  <span className="text-xs text-[var(--muted-foreground)]"> (per job)</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Structural explosion — informational */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Structural explosion</h2>
        <Card>
          <ul className="space-y-1.5 text-sm text-[var(--muted-foreground)]">
            <li>
              <span className="text-[var(--foreground)] font-medium">Trade parts under made items</span> — when a
              made item is demanded, any bought (trade) parts on its assembly list are surfaced as
              procurement demand (e.g. cast-iron door shoes inside a collapsible gate).
            </li>
            <li>
              <span className="text-[var(--foreground)] font-medium">Finish resolution</span> — a child part takes
              its parent&apos;s finish (inherit), a fixed finish (pinned), or none (neutral), so an MS bracket
              inside an SS door is ordered correctly.
            </li>
            <li>
              <span className="text-[var(--foreground)] font-medium">Programs &amp; sheets</span> — made parts explode
              through the program that cuts them down to the raw steel sheets to buy.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
