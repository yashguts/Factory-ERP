"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, X, Loader2, Save, Trash2, Container, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CabinItemPicker } from "@/components/cabin/cabin-item-picker";
import { CabinBaseFinishPicker } from "@/components/cabin/cabin-base-finish-picker";
import { CABIN_TYPES, isFinishSplitType } from "@/lib/cabin/cabin-types";
import {
  createCabinJob,
  updateCabinJob,
  deleteCabinJob,
  getCabinItemByName,
  type CabinJobDetail,
} from "@/lib/actions/cabin-jobs";

interface Row {
  _key: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
  qty: number;
  /** For an auto-added Cover row: the _key of the Support row it mirrors. */
  linkedTo?: string | null;
  /** True when this row was auto-added from a Support (qty-synced, locked). */
  auto?: boolean;
}

const makeKey = () => Math.random().toString(36).slice(2);
const emptyRow = (): Row => ({
  _key: makeKey(),
  item_id: null,
  item_code: null,
  item_name: null,
  uom: null,
  qty: 1,
});

// Picking a Support (Glass) item auto-fills the matching Cover, 1:1 by size+finish.
const SUPPORT_TO_COVER: Record<string, string> = {
  "Bottom Support (Glass)": "Bottom Support (Glass) Cover",
  "Top Support (Glass)": "Top Support (Glass) Cover",
};
const coverNameFor = (supportName: string) =>
  supportName.replace("(Glass)", "(Glass) Cover");

export function CabinJobForm({ job }: { job?: CabinJobDetail | null }) {
  const router = useRouter();
  const isEditing = !!job;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [jobNumber, setJobNumber] = useState(job?.job_number ?? "");

  const [rowsByType, setRowsByType] = useState<Record<string, Row[]>>(() => {
    const map: Record<string, Row[]> = {};
    for (const t of CABIN_TYPES) map[t] = [];
    for (const l of job?.lines ?? []) {
      if (!map[l.cabin_type]) map[l.cabin_type] = [];
      map[l.cabin_type].push({
        _key: makeKey(),
        item_id: l.item_id,
        item_code: l.item_code,
        item_name: l.item_name,
        uom: l.uom,
        qty: l.qty || 1,
      });
    }
    // Re-link saved Cover rows back to their Support rows so qty stays in sync
    // when editing an existing job.
    for (const [supportType, coverType] of Object.entries(SUPPORT_TO_COVER)) {
      for (const cr of map[coverType] ?? []) {
        if (!cr.item_name) continue;
        const sr = (map[supportType] ?? []).find(
          (s) => s.item_name && coverNameFor(s.item_name) === cr.item_name,
        );
        if (sr) {
          cr.linkedTo = sr._key;
          cr.auto = true;
        }
      }
    }
    return map;
  });

  const setRows = (type: string, fn: (rows: Row[]) => Row[]) =>
    setRowsByType((prev) => ({ ...prev, [type]: fn(prev[type] ?? []) }));

  /* --- row handlers; Support types also manage their linked Cover row --- */
  const pickItem = (
    type: string,
    key: string,
    it: { id: string; code: string; name: string; uom: string },
  ) => {
    setRows(type, (rs) =>
      rs.map((r) =>
        r._key === key
          ? { ...r, item_id: it.id, item_code: it.code, item_name: it.name, uom: it.uom }
          : r,
      ),
    );
    const coverType = SUPPORT_TO_COVER[type];
    if (!coverType) return;
    const qty = (rowsByType[type] ?? []).find((r) => r._key === key)?.qty || 1;
    getCabinItemByName(coverNameFor(it.name)).then((cover) => {
      setRowsByType((prev) => {
        const covers = prev[coverType] ?? [];
        const idx = covers.findIndex((r) => r.linkedTo === key);
        if (!cover) {
          return idx >= 0
            ? { ...prev, [coverType]: covers.filter((r) => r.linkedTo !== key) }
            : prev;
        }
        const newCover: Row = {
          _key: idx >= 0 ? covers[idx]._key : makeKey(),
          item_id: cover.id,
          item_code: cover.code,
          item_name: cover.name,
          uom: cover.uom,
          qty,
          linkedTo: key,
          auto: true,
        };
        const next =
          idx >= 0 ? covers.map((r, i) => (i === idx ? newCover : r)) : [...covers, newCover];
        return { ...prev, [coverType]: next };
      });
    });
  };

  const clearItem = (type: string, key: string) => {
    setRows(type, (rs) =>
      rs.map((r) =>
        r._key === key
          ? { ...r, item_id: null, item_code: null, item_name: null, uom: null }
          : r,
      ),
    );
    const coverType = SUPPORT_TO_COVER[type];
    if (coverType) setRows(coverType, (rs) => rs.filter((r) => r.linkedTo !== key));
  };

  const setQty = (type: string, key: string, q: number) => {
    setRows(type, (rs) => rs.map((r) => (r._key === key ? { ...r, qty: q } : r)));
    const coverType = SUPPORT_TO_COVER[type];
    if (coverType)
      setRows(coverType, (rs) => rs.map((r) => (r.linkedTo === key ? { ...r, qty: q } : r)));
  };

  const removeRow = (type: string, key: string) => {
    setRows(type, (rs) => rs.filter((r) => r._key !== key));
    const coverType = SUPPORT_TO_COVER[type];
    if (coverType) setRows(coverType, (rs) => rs.filter((r) => r.linkedTo !== key));
  };

  const totalItems = Object.values(rowsByType)
    .flat()
    .filter((r) => r.item_id).length;

  const save = () => {
    setError(null);
    if (!jobNumber.trim()) {
      setError("Job number is required.");
      return;
    }
    const lines = CABIN_TYPES.flatMap((type) =>
      (rowsByType[type] ?? [])
        .filter((r) => r.item_id && r.qty > 0)
        .map((r) => ({ cabin_type: type, item_id: r.item_id, qty: r.qty })),
    );
    startTransition(async () => {
      const res = isEditing
        ? await updateCabinJob(job!.id, { job_number: jobNumber, lines })
        : await createCabinJob({ job_number: jobNumber, lines });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/cabin-jobs");
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!job) return;
    if (!window.confirm(`Delete cabin job "${job.job_number}"?`)) return;
    startTransition(async () => {
      const res = await deleteCabinJob(job.id);
      if (!res.ok) {
        setError(res.error || "Could not delete.");
        return;
      }
      router.push("/cabin-jobs");
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-5">
        <Link
          href="/cabin-jobs"
          className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Cabin Jobs
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Container className="h-6 w-6" />
            {isEditing ? `Cabin Job ${job!.job_number}` : "New Cabin Job"}
          </h1>
          <div className="flex items-center gap-2">
            {isEditing && (
              <Button variant="destructive" onClick={onDelete} disabled={isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
            <Button onClick={save} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              {isEditing ? "Save changes" : "Create cabin job"}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
          {error}
        </div>
      )}

      {/* Header field */}
      <div className="card-surface p-4 mb-5 max-w-sm">
        <label className="block text-sm font-medium mb-1">
          Job Number <span className="text-red-500">*</span>
        </label>
        <Input
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
          placeholder="e.g., RNLBLR-0051"
          autoFocus={!isEditing}
        />
      </div>

      <p className="text-xs text-[var(--muted-foreground)] mb-3">
        {totalItems} item{totalItems === 1 ? "" : "s"} added across{" "}
        {CABIN_TYPES.length} types. Picking a Bottom/Top Support (Glass) item
        auto-adds its matching Cover.
      </p>

      {/* One block per cabin type */}
      <div className="space-y-3">
        {CABIN_TYPES.map((type) => {
          const rows = rowsByType[type] ?? [];
          return (
            <div key={type} className="card-surface">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]/40 rounded-t-[var(--radius)]">
                <h2 className="text-sm font-semibold">{type}</h2>
                {rows.filter((r) => r.item_id).length > 0 && (
                  <span className="text-xs text-[var(--muted-foreground)]">
                    · {rows.filter((r) => r.item_id).length}
                  </span>
                )}
              </div>
              <div className="p-3">
                {rows.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {rows.map((row) => (
                      <div key={row._key} className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          {row.auto ? (
                            <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-emerald-300 bg-emerald-50/50 min-w-0">
                              <Link2 className="h-3 w-3 text-emerald-600 shrink-0" />
                              <span className="text-sm font-medium truncate flex-1">
                                {row.item_name}
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-emerald-700 shrink-0">
                                auto
                              </span>
                              <span className="text-[11px] font-mono text-[var(--muted-foreground)] shrink-0">
                                {row.item_code}
                              </span>
                            </div>
                          ) : isFinishSplitType(type) ? (
                            <CabinBaseFinishPicker
                              cabinType={type}
                              itemId={row.item_id}
                              itemCode={row.item_code}
                              itemName={row.item_name}
                              onPick={(it) => pickItem(type, row._key, it)}
                              onClear={() => clearItem(type, row._key)}
                            />
                          ) : (
                            <CabinItemPicker
                              cabinType={type}
                              itemId={row.item_id}
                              itemCode={row.item_code}
                              itemName={row.item_name}
                              onPick={(it) => pickItem(type, row._key, it)}
                              onClear={() => clearItem(type, row._key)}
                            />
                          )}
                        </div>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={row.qty || ""}
                          onChange={(e) =>
                            setQty(type, row._key, e.target.value ? Number(e.target.value) : 0)
                          }
                          disabled={!row.item_id || row.auto}
                          title={row.auto ? "Quantity follows the linked Support" : undefined}
                          placeholder="Qty"
                          className="w-20 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] disabled:opacity-50"
                        />
                        <span className="w-8 text-[11px] text-[var(--muted-foreground)] mt-2 text-center shrink-0">
                          {row.uom || "—"}
                        </span>
                        {row.auto ? (
                          <span
                            className="p-1.5 text-[var(--muted-foreground)]/40 shrink-0"
                            title="Auto-added from its Support — remove the Support to remove this"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeRow(type, row._key)}
                            title="Remove"
                            className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setRows(type, (rs) => [...rs, emptyRow()])}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
                >
                  <Plus className="h-3 w-3" /> Add {type} item
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
