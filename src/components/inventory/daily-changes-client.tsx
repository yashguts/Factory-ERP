"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge as UIBadge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Undo2,
  Pencil,
  ExternalLink,
  Loader2,
  Check,
  X,
  ArrowRight,
  CalendarDays,
  History,
  Search,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  revertItemChange,
  reverseTransaction,
  updateItemChangeNote,
  updateTransactionNote,
  getItemChangeHistory,
} from "@/lib/actions/inventory-changes";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import type {
  InventoryChangeRow,
  ItemChangeRow,
  StockChangeRow,
  TransactionType,
} from "@/lib/supabase/types";

interface Props {
  initialRows: InventoryChangeRow[];
  date: string;
  maxDate: string;
}

const TXN_LABELS: Record<TransactionType, string> = {
  purchase_in: "Purchase In",
  production_in: "Production In",
  production_out: "Production Out",
  adjustment: "Adjustment",
  transfer: "Transfer",
  scrap: "Scrap",
  dispatch_out: "Dispatch Out",
};

const ACTION_BADGE_VARIANT: Record<string, BadgeVariant> = {
  create: "green",
  update: "blue",
  delete: "red",
  stock: "purple",
};

function formatStamp(iso: string, withDate?: boolean): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (!withDate) return time;
  const day = d.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${day} · ${time}`;
}

export function DailyChangesClient({ initialRows, date, maxDate }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  // Item-history mode: pick an item to see its full change history (all dates),
  // instead of the single-day feed.
  const [historyItem, setHistoryItem] = useState<{
    id: string;
    code: string;
    name: string;
  } | null>(null);
  const [historyRows, setHistoryRows] = useState<InventoryChangeRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Optional date range when viewing a single item's history ("" = no bound).
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");

  const fetchHistory = (
    item: { id: string; code: string; name: string },
    from: string,
    to: string,
  ) => {
    setHistoryItem(item);
    setHistoryLoading(true);
    startTransition(async () => {
      const rows = await getItemChangeHistory(
        item.id,
        from || undefined,
        to || undefined,
      );
      setHistoryRows(rows);
      setHistoryLoading(false);
    });
  };

  // Picking a new item starts from its full history (range cleared).
  const loadHistory = (item: { id: string; code: string; name: string }) => {
    setHistFrom("");
    setHistTo("");
    fetchHistory(item, "", "");
  };

  const setHistoryRange = (from: string, to: string) => {
    setHistFrom(from);
    setHistTo(to);
    if (historyItem) fetchHistory(historyItem, from, to);
  };

  const clearHistory = () => {
    setHistoryItem(null);
    setHistoryRows([]);
    setHistFrom("");
    setHistTo("");
  };

  // After an undo/note edit: refresh the right view (history list or day feed).
  const afterMutation = () => {
    if (historyItem) {
      fetchHistory(historyItem, histFrom, histTo);
    } else {
      router.refresh();
    }
  };

  const changeDate = (newDate: string) => {
    if (!newDate) return;
    startTransition(() => {
      router.push(`/inventory/changes?date=${newDate}`);
    });
  };

  const handleUndo = (row: InventoryChangeRow) => {
    const label =
      row.kind === "item"
        ? row.action === "create"
          ? "Undo the creation of this item? (the item will be deleted)"
          : row.action === "delete"
            ? "Restore this deleted item?"
            : "Undo this edit and restore the previous values?"
        : "Reverse this stock movement? (an offsetting adjustment will be posted)";
    if (!window.confirm(label)) return;

    setBusyId(row.id);
    startTransition(async () => {
      const res =
        row.kind === "item"
          ? await revertItemChange(row.id)
          : await reverseTransaction(row.id);
      setBusyId(null);
      if (!res.ok) {
        toast.error(`Could not undo: ${res.error}`);
        return;
      }
      toast.success(
        row.kind === "item" ? "Change undone." : "Stock move reversed with a counter-entry.",
      );
      afterMutation();
    });
  };

  const startEditNote = (row: InventoryChangeRow) => {
    setEditingNoteId(row.id);
    setNoteDraft(row.note ?? "");
  };

  const saveNote = (row: InventoryChangeRow) => {
    setBusyId(row.id);
    startTransition(async () => {
      const res =
        row.kind === "item"
          ? await updateItemChangeNote(row.id, noteDraft)
          : await updateTransactionNote(row.id, noteDraft);
      setBusyId(null);
      if (!res.ok) {
        toast.error(`Could not save note: ${res.error}`);
        return;
      }
      setEditingNoteId(null);
      toast.success("Note saved.");
      afterMutation();
    });
  };

  const renderRow = (row: InventoryChangeRow) => {
    const common = {
      busy: busyId === row.id || isPending,
      editing: editingNoteId === row.id,
      noteDraft,
      setNoteDraft,
      showDate: !!historyItem,
      onUndo: () => handleUndo(row),
      onStartEditNote: () => startEditNote(row),
      onSaveNote: () => saveNote(row),
      onCancelNote: () => setEditingNoteId(null),
    };
    return row.kind === "item" ? (
      <ItemChangeCard key={row.id} row={row} {...common} />
    ) : (
      <StockChangeCard key={row.id} row={row} {...common} />
    );
  };

  return (
    <div>
      {/* Header */}
      <PageHeader
        icon={<History size={18} />}
        title="Inventory Changes"
        meta={`${
          historyItem
            ? `Change history for ${historyItem.name}${
                histFrom || histTo
                  ? ` · ${histFrom || "…"} → ${histTo || "…"}`
                  : ""
              }`
            : `${initialRows.length} change${initialRows.length === 1 ? "" : "s"} on this day`
        }${isPending ? " — refreshing..." : ""}`}
        actions={
          <>
            <CalendarDays size={16} className="text-[var(--muted-foreground)]" />
            {historyItem ? (
              <>
                <Input
                  size="sm"
                  type="date"
                  value={histFrom}
                  max={histTo || maxDate}
                  onChange={(e) => setHistoryRange(e.target.value, histTo)}
                  title="From date (leave blank for no lower bound)"
                  className="w-auto cursor-pointer"
                />
                <span className="text-[var(--muted-foreground)]">→</span>
                <Input
                  size="sm"
                  type="date"
                  value={histTo}
                  min={histFrom || undefined}
                  max={maxDate}
                  onChange={(e) => setHistoryRange(histFrom, e.target.value)}
                  title="To date (leave blank for no upper bound)"
                  className="w-auto cursor-pointer"
                />
              </>
            ) : (
              <Input
                size="sm"
                type="date"
                value={date}
                max={maxDate}
                onChange={(e) => changeDate(e.target.value)}
                title="Browse changes by day"
                className="w-auto cursor-pointer"
              />
            )}
            <Link href="/inventory">
              <Button size="sm" variant="secondary">
                Back to Inventory
              </Button>
            </Link>
          </>
        }
      />

      {/* Item-history search */}
      <div className="mb-4">
        <ItemHistorySearch
          selected={historyItem}
          onPick={loadHistory}
          onClear={clearHistory}
        />
      </div>

      {/* Body: item history OR single-day feed */}
      {historyItem ? (
        historyLoading ? (
          <EmptyState
            icon={<Loader2 size={28} className="animate-spin" />}
            title="Loading history..."
          />
        ) : historyRows.length === 0 ? (
          <EmptyState
            icon={<History size={28} />}
            title="No recorded changes for this item yet."
          />
        ) : (
          <div className="space-y-2">{historyRows.map(renderRow)}</div>
        )
      ) : initialRows.length === 0 ? (
        <EmptyState
          icon={<History size={28} />}
          title="No inventory changes were recorded on this date."
        />
      ) : (
        <div className="space-y-2">{initialRows.map(renderRow)}</div>
      )}
    </div>
  );
}

/** Fuzzy item search (all categories) → load that item's full change history. */
function ItemHistorySearch({
  selected,
  onPick,
  onClear,
}: {
  selected: { id: string; code: string; name: string } | null;
  onPick: (item: { id: string; code: string; name: string }) => void;
  onClear: () => void;
}) {
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
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (selected) {
    return (
      <div className="card-surface p-3 flex items-center gap-2 flex-wrap">
        <History size={16} className="text-[var(--primary)] shrink-0" />
        <span className="text-sm font-medium">{selected.name}</span>
        <span className="font-mono text-xs text-[var(--muted-foreground)]">
          {selected.code}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          — full change history
        </span>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
        >
          <X size={13} /> Clear / back to day view
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="card-surface p-3">
      <label className="text-xs font-semibold text-[var(--muted-foreground)] flex items-center gap-1.5 mb-2">
        <Search size={13} /> Find an item to see its full history
      </label>
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none z-10" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by code or name across all categories..."
          className="pl-9 pr-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
        )}
        {open && search.trim() && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-80 overflow-y-auto">
            {results.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                {loading ? "Searching..." : "No items found"}
              </div>
            ) : (
              results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onPick({ id: item.id, code: item.code, name: item.name });
                    setSearch("");
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                >
                  <div className="font-medium leading-snug break-words">
                    {item.name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted-foreground)]">
                    <span className="font-mono">{item.code}</span>
                    {item.category_name && (
                      <span className="italic">{item.category_name}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface CardCommonProps {
  busy: boolean;
  editing: boolean;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  /** Show full date alongside the time (item-history view spans many days). */
  showDate?: boolean;
  onUndo: () => void;
  onStartEditNote: () => void;
  onSaveNote: () => void;
  onCancelNote: () => void;
}

function CardShell({
  children,
  dimmed,
}: {
  children: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`card-surface p-3 ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      {children}
    </div>
  );
}

function ActionBadge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <UIBadge variant={ACTION_BADGE_VARIANT[kind] ?? "neutral"}>
      {children}
    </UIBadge>
  );
}

function NoteRow({
  note,
  editing,
  noteDraft,
  setNoteDraft,
  busy,
  onStartEditNote,
  onSaveNote,
  onCancelNote,
}: {
  note: string | null;
} & CardCommonProps) {
  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Add a note / reason..."
          autoFocus
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          onClick={onSaveNote}
          disabled={busy}
          title="Save note"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onCancelNote}
          disabled={busy}
          title="Cancel"
        >
          <X size={14} />
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      {note ? (
        <span className="text-[var(--foreground)]">
          <span className="text-[var(--muted-foreground)]">Note:</span> {note}
        </span>
      ) : (
        <span className="text-[var(--muted-foreground)] italic">No note</span>
      )}
      <button
        type="button"
        onClick={onStartEditNote}
        className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline cursor-pointer"
      >
        <Pencil size={12} /> {note ? "Edit" : "Add note"}
      </button>
    </div>
  );
}

function ItemChangeCard({
  row,
  ...common
}: { row: ItemChangeRow } & CardCommonProps) {
  const isReverted = !!row.reverted_at;
  return (
    <CardShell dimmed={isReverted}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ActionBadge kind={row.action}>
              {row.action === "create"
                ? "Created"
                : row.action === "delete"
                  ? "Deleted"
                  : "Updated"}
            </ActionBadge>
            {row.item_code && (
              <span className="font-mono text-xs text-[var(--muted-foreground)]">
                {row.item_code}
              </span>
            )}
            <span className="font-medium truncate">
              {row.item_name ?? "(unknown item)"}
            </span>
            {row.revert_of && (
              <span className="text-[11px] text-[var(--muted-foreground)]">
                (undo of an earlier change)
              </span>
            )}
            {isReverted && (
              <span className="text-[11px] font-medium text-[var(--warning)]">
                · Reverted
              </span>
            )}
          </div>

          {/* Diff / detail */}
          <div className="mt-2 text-sm">
            {row.action === "delete" ? (
              <span className="text-[var(--muted-foreground)]">
                {row.item_id
                  ? "Item hidden from active lists (can be restored)."
                  : "Item permanently deleted."}
              </span>
            ) : row.changes.length === 0 ? (
              <span className="text-[var(--muted-foreground)] italic">
                Note-only change.
              </span>
            ) : (
              <ul className="space-y-1">
                {row.changes.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 flex-wrap">
                    <span className="text-[var(--muted-foreground)] min-w-[110px]">
                      {c.label ?? c.field}
                    </span>
                    {row.action === "create" ? (
                      <span className="font-medium">{c.new_display}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="line-through text-[var(--muted-foreground)]">
                          {c.old_display}
                        </span>
                        <ArrowRight size={12} />
                        <span className="font-medium">{c.new_display}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <NoteRow note={row.note} {...common} />
        </div>

        {/* Right column: time + actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-xs text-[var(--muted-foreground)]">
            {formatStamp(row.created_at, common.showDate)}
          </span>
          <div className="flex items-center gap-2">
            {row.item_id && (
              <Link href={`/inventory?edit=${row.item_id}`}>
                <Button size="sm" variant="secondary" title="Open this item to re-edit">
                  <ExternalLink size={14} className="mr-1" /> Edit item
                </Button>
              </Link>
            )}
            {row.can_undo && (
              <Button
                size="sm"
                variant="secondary"
                onClick={common.onUndo}
                disabled={common.busy}
                title="Undo this change"
              >
                {common.busy ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Undo2 size={14} className="mr-1" />
                )}
                Undo
              </Button>
            )}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function StockChangeCard({
  row,
  ...common
}: { row: StockChangeRow } & CardCommonProps) {
  const positive = row.quantity >= 0;
  return (
    <CardShell>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ActionBadge kind="stock">Stock</ActionBadge>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              {TXN_LABELS[row.transaction_type]}
            </span>
            {row.item_code && (
              <span className="font-mono text-xs text-[var(--muted-foreground)]">
                {row.item_code}
              </span>
            )}
            <span className="font-medium truncate">
              {row.item_name ?? "(unknown item)"}
            </span>
          </div>

          <div className="mt-2 text-sm flex items-center gap-2 flex-wrap">
            <span
              className={`font-semibold ${
                positive ? "text-[var(--success)]" : "text-[var(--destructive)]"
              }`}
            >
              {positive ? "+" : ""}
              {row.quantity}
            </span>
            {row.warehouse_name && (
              <span className="text-[var(--muted-foreground)]">
                @ {row.warehouse_name}
              </span>
            )}
          </div>

          <NoteRow note={row.note} {...common} />
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-xs text-[var(--muted-foreground)]">
            {formatStamp(row.created_at, common.showDate)}
          </span>
          {row.can_undo && (
            <Button
              size="sm"
              variant="secondary"
              onClick={common.onUndo}
              disabled={common.busy}
              title="Reverse this stock movement"
            >
              {common.busy ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Undo2 size={14} className="mr-1" />
              )}
              Reverse
            </Button>
          )}
        </div>
      </div>
    </CardShell>
  );
}
