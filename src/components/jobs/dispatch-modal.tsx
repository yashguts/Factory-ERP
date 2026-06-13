"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Search, Loader2, X, Plus, Truck, Info } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import {
  getJobDispatchSummary,
  createDispatch,
  type JobDispatchSummary,
  type PhaseScope,
} from "@/lib/actions/dispatch";

interface Props {
  jobId: string;
  jobNumber: string;
  onClose: () => void;
  onSaved: () => void;
}

interface Row {
  _key: string;
  job_bom_line_id: string | null;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
  category: string | null;
  required: number | null; // null = ad-hoc (not in BOM)
  dispatched: number;
  remaining: number | null;
  qty: number; // dispatch now
  // When sending less than what's left, the user ticks this to say "the rest
  // isn't needed" — revising the BOM requirement down instead of a partial.
  closeLine: boolean;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const makeKey = () => Math.random().toString(36).slice(2);

/** A real BOM line being sent for LESS than what's left — the only case where
 *  "partial vs requirement revised" is an open question. */
function isUnderDispatch(r: Row): boolean {
  return (
    r.job_bom_line_id != null &&
    r.remaining != null &&
    r.qty > 0 &&
    r.qty < r.remaining
  );
}
/** If the user closes the line, the requirement is revised to what's actually
 *  been provided (prior dispatched + this dispatch). */
const revisedRequiredFor = (r: Row) => r.dispatched + r.qty;

const SCOPE_LABEL: Record<PhaseScope, string> = {
  first: "First phase only",
  second: "Second phase only",
  full: "Entire job",
};

export function DispatchModal({ jobId, jobNumber, onClose, onSaved }: Props) {
  const toast = useToast();
  const [summary, setSummary] = useState<JobDispatchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<PhaseScope>("first");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const buildRows = useCallback(
    (s: JobDispatchSummary, sc: PhaseScope): Row[] =>
      s.lines
        .filter((l) => (sc === "full" ? true : l.phase === sc))
        .map((l) => ({
          _key: makeKey(),
          job_bom_line_id: l.job_bom_line_id,
          item_id: l.item_id,
          item_code: l.item_code,
          item_name: l.item_name,
          uom: l.uom,
          category: l.category,
          required: l.required,
          dispatched: l.dispatched,
          remaining: l.remaining,
          qty: l.remaining, // default: dispatch what's left
          closeLine: false,
        })),
    [],
  );

  useEffect(() => {
    let active = true;
    getJobDispatchSummary(jobId)
      .then((s) => {
        if (!active) return;
        setSummary(s);
        setRows(buildRows(s, "first"));
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [jobId, buildRows]);

  const changeScope = (sc: PhaseScope) => {
    setScope(sc);
    if (summary) setRows(buildRows(summary, sc));
  };

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => rs.filter((r) => r._key !== key));
  const addAdhoc = () =>
    setRows((rs) => [
      ...rs,
      {
        _key: makeKey(),
        job_bom_line_id: null,
        item_id: null,
        item_code: null,
        item_name: null,
        uom: null,
        category: null,
        required: null,
        dispatched: 0,
        remaining: null,
        qty: 1,
        closeLine: false,
      },
    ]);

  const activeRows = rows.filter((r) => r.item_id && r.qty > 0);
  const totalQty = activeRows.reduce((a, r) => a + r.qty, 0);

  const save = () => {
    setError(null);
    if (activeRows.length === 0) {
      setError("Add at least one item with a quantity to dispatch.");
      return;
    }
    startTransition(async () => {
      const res = await createDispatch({
        job_id: jobId,
        dispatch_date: date,
        phase_scope: scope,
        note,
        lines: activeRows.map((r) => ({
          job_bom_line_id: r.job_bom_line_id,
          item_id: r.item_id,
          category: r.category,
          qty: r.qty,
          // Only a ticked, genuinely-under-dispatched line revises the BOM.
          revised_required:
            r.closeLine && isUnderDispatch(r) ? revisedRequiredFor(r) : null,
        })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(
        `Dispatch recorded for Job ${jobNumber} — ${SCOPE_LABEL[scope]}, ${activeRows.length} item${activeRows.length === 1 ? "" : "s"}, ${totalQty.toLocaleString()} qty. See it in the Dispatch panel.`,
      );
      onSaved();
      onClose();
    });
  };

  return (
    <Modal
      title={`Dispatch — Job ${jobNumber}`}
      onClose={onClose}
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}

        {/* Date + scope */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Dispatch date</label>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">What is going out?</label>
            <Select value={scope} onChange={(e) => changeScope(e.target.value as PhaseScope)}>
              <option value="first">{SCOPE_LABEL.first}</option>
              <option value="second">{SCOPE_LABEL.second}</option>
              <option value="full">{SCOPE_LABEL.full}</option>
            </Select>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
              {scope === "first"
                ? "1st phase = structure material: rails, brackets, door frames, sills, linton, controller stand…"
                : scope === "second"
                  ? "2nd phase = finishing material: doors, cabin, COP/LOP and everything else."
                  : "Everything still pending on this job's BOM."}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
            Loading items…
          </div>
        ) : (
          <div className="border border-[var(--border)] rounded-md overflow-hidden">
            {/* header */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-[var(--muted)]/50 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <span>Item</span>
              <span className="w-44 text-right">Required · Sent · Left</span>
              <span className="w-28 text-right">Dispatch now</span>
            </div>
            <div className="max-h-[45vh] overflow-y-auto divide-y divide-[var(--border)]">
              {rows.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  No {scope === "full" ? "" : SCOPE_LABEL[scope].toLowerCase().replace(" only", "")} items on this job&rsquo;s BOM. Use &ldquo;Add item&rdquo; below.
                </div>
              ) : (
                rows.map((row) => (
                  <DispatchRow
                    key={row._key}
                    row={row}
                    onPick={(it) =>
                      updateRow(row._key, {
                        item_id: it.id,
                        item_code: it.code,
                        item_name: it.name,
                        uom: it.uom_abbreviation,
                      })
                    }
                    onClear={() =>
                      updateRow(row._key, {
                        item_id: null,
                        item_code: null,
                        item_name: null,
                        uom: null,
                      })
                    }
                    onQty={(q) => updateRow(row._key, { qty: q })}
                    onClose={(v) => updateRow(row._key, { closeLine: v })}
                    onRemove={() => removeRow(row._key)}
                  />
                ))
              )}
            </div>
            <div className="px-3 py-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={addAdhoc}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
              >
                <Plus className="h-3 w-3" /> Add item (not on the BOM)
              </button>
            </div>
          </div>
        )}

        {/* note */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Note <span className="text-[var(--muted-foreground)] font-normal text-xs">(optional)</span>
          </label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., vehicle no., LR no., partial — balance next week" />
        </div>

        {/* The rule is intentional (Phase 0): recording a dispatch never
            touches stock. Saying it here removes the main post-save confusion. */}
        <p className="flex items-start gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
          This records what left the factory and updates the job&rsquo;s dispatch
          status. It does <span className="font-semibold">not</span> deduct stock
          from inventory.
        </p>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
          <span className="text-xs text-[var(--muted-foreground)]">
            {activeRows.length} item{activeRows.length === 1 ? "" : "s"} · {totalQty.toLocaleString()} total qty
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={isPending || activeRows.length === 0}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Truck className="h-3.5 w-3.5 mr-1.5" />}
              Mark dispatched
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function DispatchRow({
  row,
  onPick,
  onClear,
  onQty,
  onClose,
  onRemove,
}: {
  row: Row;
  onPick: (it: SearchableItem) => void;
  onClear: () => void;
  onQty: (q: number) => void;
  onClose: (v: boolean) => void;
  onRemove: () => void;
}) {
  const overdraw = row.remaining != null && row.qty > row.remaining;
  const fullyDone = row.remaining === 0 && row.qty === 0;
  // Sending less than what's left: is the rest still needed (partial) or not
  // (revise the requirement)? This is the case the UI must make explicit.
  const under = isUnderDispatch(row);
  const dropped = under ? (row.remaining as number) - row.qty : 0;
  const revisedTo = revisedRequiredFor(row);
  return (
    <div className={fullyDone ? "opacity-55" : ""}>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 items-center">
      <div className="min-w-0">
        {row.item_id ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{row.item_name}</div>
              <div className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-2 flex-wrap">
                <span className="font-mono">{row.item_code}</span>
                {row.category && <span className="italic">{row.category}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              title="Change item"
              className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <ItemSearch onPick={onPick} />
        )}
      </div>

      <div className="w-44 text-right text-xs tabular-nums">
        {row.required != null ? (
          <span className="text-[var(--muted-foreground)]">
            {row.required.toLocaleString()} · {row.dispatched.toLocaleString()} ·{" "}
            <span className={row.remaining ? "text-amber-600 font-medium" : "text-green-600 font-medium"}>
              {(row.remaining ?? 0).toLocaleString()}
            </span>
          </span>
        ) : (
          <span className="text-[var(--muted-foreground)] italic">ad-hoc</span>
        )}
      </div>

      <div className="w-28 flex items-center justify-end gap-1.5">
        <input
          type="number"
          min={0}
          step="any"
          value={row.qty || ""}
          onChange={(e) => onQty(e.target.value ? Number(e.target.value) : 0)}
          disabled={!row.item_id}
          className={`w-16 h-8 px-2 text-sm text-right rounded-md border bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] disabled:opacity-50 ${
            overdraw ? "border-amber-400" : "border-[var(--border)]"
          }`}
          title={overdraw ? "More than the remaining quantity" : undefined}
        />
        <span className="w-7 text-[11px] text-[var(--muted-foreground)] text-center shrink-0">{row.uom || "—"}</span>
        <button
          type="button"
          onClick={onRemove}
          title="Remove"
          className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      </div>

      {under && (
        <div className="px-3 pb-2 -mt-0.5">
          <label className="inline-flex items-start gap-1.5 text-[11px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={row.closeLine}
              onChange={(e) => onClose(e.target.checked)}
              className="mt-px cursor-pointer accent-[var(--primary)]"
            />
            <span className={row.closeLine ? "text-green-700 font-medium" : "text-[var(--muted-foreground)]"}>
              {row.closeLine ? (
                <>
                  Requirement revised to{" "}
                  <b>{revisedTo.toLocaleString()}</b> — the other{" "}
                  {dropped.toLocaleString()} won&rsquo;t appear in MRP.
                </>
              ) : (
                <>
                  Sending {row.qty.toLocaleString()} of{" "}
                  {(row.remaining as number).toLocaleString()} left;{" "}
                  <b>{dropped.toLocaleString()} stays required</b> in MRP — tick
                  if it&rsquo;s no longer needed.
                </>
              )}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

/** Compact inventory search for swapping / adding a dispatch item. */
function ItemSearch({ onPick }: { onPick: (it: SearchableItem) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const data = await searchItems(q, undefined, 20);
        if (seqRef.current === seq) setResults(data);
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 250);
  }, []);

  useEffect(() => {
    if (open) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, doSearch]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search an item to dispatch…"
        className="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />}
      {open && search.trim() && (
        <div className="absolute z-50 mt-1 w-full min-w-[380px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">
              {loading ? "Searching…" : "No items found"}
            </div>
          ) : (
            results.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  onPick(it);
                  setSearch("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
              >
                <div className="font-medium leading-snug break-words">{it.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                  <span className="font-mono">{it.code}</span>
                  {it.category_name && <span className="italic">{it.category_name}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
