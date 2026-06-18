"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Network, Search, Loader2, Plus, Trash2, X, ArrowRight, Sparkles, Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getInventoryPage, type InventoryRow } from "@/lib/actions/inventory";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import {
  getDemandRulesForChild,
  createDemandRule,
  deleteDemandRule,
  compileDemandRule,
  type DemandRuleRow,
  type CompiledRuleDraft,
} from "@/lib/actions/demand-rules";
import type { DemandSource } from "@/lib/supabase/types";

const DEMAND_BADGE: Record<DemandSource, { variant: BadgeVariant; label: string }> = {
  jobs: { variant: "blue", label: "Jobs" },
  formula: { variant: "purple", label: "Formula" },
  none: { variant: "amber", label: "No link" },
  tooling: { variant: "neutral", label: "Tooling" },
};

type Filter = "none" | "all";

export function DemandBuilderClient({
  initialRows,
  initialTotal,
}: {
  initialRows: InventoryRow[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState<InventoryRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [noDemandTotal, setNoDemandTotal] = useState(initialTotal);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("none");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const seqRef = useRef(0);
  const toast = useToast();

  // AI plain-English rule compiler.
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState<CompiledRuleDraft | null>(null);

  const fetchRows = useCallback(async (f: Filter, q: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await getInventoryPage({
        demand: f === "none" ? "none" : "all",
        search: q.trim() || undefined,
        page: 1,
        pageSize: 50,
        sort: "code",
        dir: "asc",
      });
      if (seqRef.current !== seq) return;
      setRows(res.rows);
      setTotal(res.total);
      if (f === "none" && !q.trim()) setNoDemandTotal(res.total);
    } finally {
      if (seqRef.current === seq) setLoading(false);
    }
  }, []);

  // Debounced refetch on search / filter change (skip the very first render — SSR seeded it).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => fetchRows(filter, search), 250);
    return () => clearTimeout(t);
  }, [filter, search, fetchRows]);

  const onRulesChanged = () => fetchRows(filter, search); // demand may flip after editing

  const interpret = async () => {
    if (!aiText.trim() || aiBusy) return;
    setAiBusy(true);
    setAiDraft(null);
    const res = await compileDemandRule(aiText);
    setAiBusy(false);
    if (!res.ok) return toast.error(res.error);
    setAiDraft(res.draft);
  };
  const saveDraft = async () => {
    if (!aiDraft) return;
    setAiBusy(true);
    const res = await createDemandRule({
      childItemId: aiDraft.child.id,
      parentItemId: aiDraft.parent.id,
      qty: aiDraft.qty,
      note: aiText.trim() || null,
    });
    setAiBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Rule saved — ${aiDraft.qty} ${aiDraft.child.name} per ${aiDraft.parent.name}.`);
    setAiDraft(null);
    setAiText("");
    onRulesChanged();
  };

  return (
    <div>
      <PageHeader
        icon={<Network size={18} />}
        title="Demand Rules"
        meta="Define how an item gets demanded when it isn't picked directly on a job's BOM"
      />

      {/* AI plain-English rule compiler */}
      <div className="card-surface p-3 mb-3">
        <div className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
          <Sparkles size={15} className="text-[var(--primary)]" /> Describe a demand rule in plain English
        </div>
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") interpret(); }}
            placeholder="e.g. 2 guide shoes per safety frame"
            className="flex-1"
            disabled={aiBusy}
          />
          <Button size="sm" onClick={interpret} disabled={aiBusy || !aiText.trim()}>
            {aiBusy && !aiDraft ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            Interpret
          </Button>
        </div>
        {aiDraft && (
          <div className="mt-2.5 rounded-md border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3">
            <div className="text-xs text-[var(--muted-foreground)] mb-1">
              Interpreted{" "}
              <Badge variant={aiDraft.confidence === "high" ? "green" : aiDraft.confidence === "medium" ? "amber" : "red"}>
                {aiDraft.confidence} confidence
              </Badge>
            </div>
            <div className="text-sm">
              <span className="font-semibold tabular-nums">{aiDraft.qty.toLocaleString()}</span> ×{" "}
              <span className="font-medium">{aiDraft.child.name}</span>{" "}
              <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{aiDraft.child.code}</span>{" "}
              <span className="text-[var(--muted-foreground)]">per</span>{" "}
              <span className="font-medium">{aiDraft.parent.name}</span>{" "}
              <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{aiDraft.parent.code}</span>
            </div>
            {aiDraft.note && <div className="text-[11px] text-[var(--warning)] mt-1">⚠ {aiDraft.note}</div>}
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={saveDraft} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                Save rule
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAiDraft(null)} disabled={aiBusy}>Discard</Button>
            </div>
          </div>
        )}
      </div>

      <StatStrip className="mb-3">
        <StatTile label="Items with no demand" value={noDemandTotal.toLocaleString()} tone={noDemandTotal > 0 ? "warn" : "ok"} />
        <StatTile label="Showing" value={total.toLocaleString()} sub={filter === "none" ? "no demand source" : "all items"} />
      </StatStrip>

      <Toolbar>
        <div className="relative w-full max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input size="sm" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
          <button
            type="button"
            onClick={() => setFilter("none")}
            className={cn("cursor-pointer px-3 py-1.5 transition-colors", filter === "none" ? "bg-[var(--primary)]/10 font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]")}
          >
            Needs a formula
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn("cursor-pointer border-l border-[var(--border)] px-3 py-1.5 transition-colors", filter === "all" ? "bg-[var(--primary)]/10 font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]")}
          >
            All items
          </button>
        </div>
        <ToolbarSpacer />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />}
      </Toolbar>

      {rows.length === 0 ? (
        <div className="card-surface overflow-hidden">
          <EmptyState
            icon={<Network size={28} />}
            title={filter === "none" ? "Nothing without a demand source" : "No items match"}
            description={filter === "none" ? "Every item is reached by a job, a formula, or is tooling." : undefined}
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Make/Trade</TableHead>
                <TableHead>Demand</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const d = DEMAND_BADGE[r.demand_source];
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-[var(--muted)]" onClick={() => setEditing(r)}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-[var(--muted-foreground)]">{r.category_name ?? "—"}</TableCell>
                    <TableCell>
                      {r.effective_procurement_type
                        ? <Badge variant={r.effective_procurement_type === "make" ? "blue" : "amber"}>{r.effective_procurement_type === "make" ? "Make" : "Trade"}</Badge>
                        : <span className="text-[var(--muted-foreground)]">—</span>}
                    </TableCell>
                    <TableCell><Badge variant={d.variant}>{d.label}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{r.total_stock.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="secondary">Define formula</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <DemandRuleEditor item={editing} onClose={() => setEditing(null)} onChanged={onRulesChanged} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DemandRuleEditor({
  item,
  onClose,
  onChanged,
}: {
  item: InventoryRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [rules, setRules] = useState<DemandRuleRow[] | null>(null);
  const [parent, setParent] = useState<SearchableItem | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRules = useCallback(async () => {
    const r = await getDemandRulesForChild(item.id);
    setRules(r);
  }, [item.id]);
  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const add = async () => {
    if (!parent) return toast.error("Pick the parent item this is demanded per.");
    const q = Number(qty);
    setBusy(true);
    const res = await createDemandRule({ childItemId: item.id, parentItemId: parent.id, qty: q, note: note.trim() || null });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Rule added — ${q} per ${parent.name}.`);
    setParent(null);
    setQty("1");
    setNote("");
    await loadRules();
    onChanged();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const res = await deleteDemandRule(id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Rule removed.");
    await loadRules();
    onChanged();
  };

  return (
    <Modal title={`Demand formula — ${item.name}`} onClose={onClose} className="max-w-2xl">
      <div className="space-y-4">
        <div className="text-xs text-[var(--muted-foreground)]">
          <span className="font-mono">{item.code}</span> — define what makes this item demanded. Each rule says: for every demanded
          <span className="font-medium text-[var(--foreground)]"> parent</span> item, also require a quantity of this one.
        </div>

        {/* Existing rules */}
        <div className="rounded-md border border-[var(--border)] overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] bg-[var(--muted)]/40">
            This item is demanded per…
          </div>
          {rules === null ? (
            <div className="px-3 py-4 text-sm text-[var(--muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin inline mr-1.5" /> Loading…</div>
          ) : rules.length === 0 ? (
            <div className="px-3 py-4 text-sm text-[var(--muted-foreground)]">No formula yet — add one below.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-semibold tabular-nums">{r.qty.toLocaleString()}</span>
                  <span className="text-[var(--muted-foreground)]">per</span>
                  <span className="font-mono text-xs text-[var(--muted-foreground)]">{r.parent_code}</span>
                  <span className="font-medium">{r.parent_name}</span>
                  {r.note && <span className="text-[11px] text-[var(--muted-foreground)] italic">· {r.note}</span>}
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    disabled={busy}
                    title="Remove rule"
                    className="ml-auto p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add a rule */}
        <div className="rounded-md border border-[var(--border)] p-3 space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Add a formula</div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="w-20">
              <label className="block text-[11px] text-[var(--muted-foreground)] mb-1">Qty</label>
              <Input size="sm" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="text-right" />
            </div>
            <span className="pb-2 text-sm text-[var(--muted-foreground)]">per</span>
            <div className="flex-1 min-w-[220px]">
              <label className="block text-[11px] text-[var(--muted-foreground)] mb-1">Parent item (the demanded one)</label>
              {parent ? (
                <div className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 h-8">
                  <span className="text-sm truncate flex-1"><span className="font-mono text-xs text-[var(--muted-foreground)] mr-1.5">{parent.code}</span>{parent.name}</span>
                  <button type="button" onClick={() => setParent(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"><X size={14} /></button>
                </div>
              ) : (
                <ParentSearch onPick={setParent} excludeId={item.id} />
              )}
            </div>
          </div>
          <Input size="sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. 2 guide shoes per safety frame" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--muted-foreground)] inline-flex items-center gap-1">
              <ArrowRight size={12} /> Demand for {item.code} = qty × the parent&rsquo;s demand.
            </p>
            <Button size="sm" onClick={add} disabled={busy || !parent}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />} Add rule
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Compact inventory search for picking a parent item. */
function ParentSearch({ onPick, excludeId }: { onPick: (it: SearchableItem) => void; excludeId: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const data = await searchItems(q, undefined, 20);
        if (seqRef.current === seq) setResults(data.filter((d) => d.id !== excludeId));
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, excludeId]);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search the parent item…"
        className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />}
      {open && q.trim() && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-60 overflow-y-auto">
          {results.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onPick(it);
                setQ("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
            >
              <div className="font-medium truncate">{it.name}</div>
              <div className="text-[11px] text-[var(--muted-foreground)] font-mono">{it.code}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
