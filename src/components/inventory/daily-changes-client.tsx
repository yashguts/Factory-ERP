"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import {
  revertItemChange,
  reverseTransaction,
  updateItemChangeNote,
  updateTransactionNote,
} from "@/lib/actions/inventory-changes";
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
};

const ACTION_BADGE: Record<string, string> = {
  create: "bg-green-100 text-green-800 border-green-200",
  update: "bg-blue-100 text-blue-800 border-blue-200",
  delete: "bg-red-100 text-red-800 border-red-200",
  stock: "bg-purple-100 text-purple-800 border-purple-200",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DailyChangesClient({ initialRows, date, maxDate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const changeDate = (newDate: string) => {
    if (!newDate) return;
    startTransition(() => {
      router.push(`/inventory/changes?date=${newDate}`);
    });
  };

  const refresh = () => startTransition(() => router.refresh());

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
        alert(`Could not undo: ${res.error}`);
        return;
      }
      router.refresh();
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
        alert(`Could not save note: ${res.error}`);
        return;
      }
      setEditingNoteId(null);
      router.refresh();
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History size={22} /> Daily Inventory Changes
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {initialRows.length} change{initialRows.length === 1 ? "" : "s"} on
            this day
            {isPending ? " — refreshing..." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays
            size={16}
            className="text-[var(--muted-foreground)]"
          />
          <input
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => changeDate(e.target.value)}
            className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm cursor-pointer"
          />
          <Link href="/inventory">
            <Button variant="secondary">Back to Inventory</Button>
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {initialRows.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-12 text-center">
          <History
            size={32}
            className="mx-auto mb-3 text-[var(--muted-foreground)]"
          />
          <p className="text-sm text-[var(--muted-foreground)]">
            No inventory changes were recorded on this date.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {initialRows.map((row) =>
            row.kind === "item" ? (
              <ItemChangeCard
                key={row.id}
                row={row}
                busy={busyId === row.id || isPending}
                editing={editingNoteId === row.id}
                noteDraft={noteDraft}
                setNoteDraft={setNoteDraft}
                onUndo={() => handleUndo(row)}
                onStartEditNote={() => startEditNote(row)}
                onSaveNote={() => saveNote(row)}
                onCancelNote={() => setEditingNoteId(null)}
              />
            ) : (
              <StockChangeCard
                key={row.id}
                row={row}
                busy={busyId === row.id || isPending}
                editing={editingNoteId === row.id}
                noteDraft={noteDraft}
                setNoteDraft={setNoteDraft}
                onUndo={() => handleUndo(row)}
                onStartEditNote={() => startEditNote(row)}
                onSaveNote={() => saveNote(row)}
                onCancelNote={() => setEditingNoteId(null)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface CardCommonProps {
  busy: boolean;
  editing: boolean;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
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
      className={`rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        ACTION_BADGE[kind] ?? "bg-gray-100 text-gray-700 border-gray-200"
      }`}
    >
      {children}
    </span>
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
            <Badge kind={row.action}>
              {row.action === "create"
                ? "Created"
                : row.action === "delete"
                  ? "Deleted"
                  : "Updated"}
            </Badge>
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
              <span className="text-[11px] font-medium text-amber-700">
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
            {formatTime(row.created_at)}
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
            <Badge kind="stock">Stock</Badge>
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
                positive ? "text-green-700" : "text-red-700"
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
            {formatTime(row.created_at)}
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
