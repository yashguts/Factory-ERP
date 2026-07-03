"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, X, Loader2, Save, Trash2, Container, Link2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CabinItemPicker } from "@/components/cabin/cabin-item-picker";
import { CabinBaseFinishPicker } from "@/components/cabin/cabin-base-finish-picker";
import { CabinJobOrderPicker } from "@/components/cabin/cabin-job-order-picker";
import { CabinSketchAutofill } from "@/components/cabin/cabin-sketch-autofill";
import { CabinSketchView } from "@/components/cabin/cabin-sketch-view";
import type { CabinAutofillData } from "@/lib/actions/cabin-autofill";
import { CABIN_TYPES, isFinishSplitType } from "@/lib/cabin/cabin-types";
import {
  createCabinJob,
  updateCabinJob,
  deleteCabinJob,
  getCabinItemByName,
  setCabinJobReviewed,
  type CabinJobDetail,
  type CabinJobLine,
} from "@/lib/actions/cabin-jobs";

interface Row {
  _key: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_family?: string | null;
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

// Picking a GLASS Front Wall item (RHS/LHS) auto-fills its matching Front Cover.
// The Front Cover item name = the glass item's name with " FRONT COVER" inserted
// right after the GLASS token (e.g. "AT P1R-00 RHO STD GLASS SS 304" ->
// "AT P1R-00 RHO STD GLASS FRONT COVER SS 304"). Non-glass front walls have no
// front cover, so they pair to nothing.
const FRONT_WALL_TYPES = new Set(["Front Wall RHS", "Front Wall LHS"]);
const FRONT_COVER_TYPE = "Front Cover";
const frontCoverNameFor = (glassName: string) =>
  glassName.replace(/\bGLASS\b/i, "GLASS FRONT COVER");

/** Which "cover" block (if any) a picked row in `type` should auto-fill. */
function coverTypeForSource(type: string): string | null {
  if (SUPPORT_TO_COVER[type]) return SUPPORT_TO_COVER[type];
  if (FRONT_WALL_TYPES.has(type)) return FRONT_COVER_TYPE;
  return null;
}
/** The cover item NAME to look up for this pick, or null when the pick has no
 *  cover (e.g. a non-GLASS Front Wall item). */
function coverNameForSource(type: string, itemName: string): string | null {
  if (SUPPORT_TO_COVER[type]) return coverNameFor(itemName);
  if (FRONT_WALL_TYPES.has(type))
    return /\bGLASS\b/i.test(itemName) ? frontCoverNameFor(itemName) : null;
  return null;
}

export function CabinJobForm({
  job,
  cloneFrom,
}: {
  job?: CabinJobDetail | null;
  /** Seed a NEW job from this existing job's items (job number stays blank). */
  cloneFrom?: CabinJobDetail | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const isEditing = !!job;
  const cloning = !job && !!cloneFrom;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Editing keeps the job's number; cloning starts blank (it's a new job).
  const [jobNumber, setJobNumber] = useState(job?.job_number ?? "");
  // Customer comes from the linked Job Order (auto-filled on pick).
  const [customerName, setCustomerName] = useState<string | null>(job?.customer_name ?? null);

  const [rowsByType, setRowsByType] = useState<Record<string, Row[]>>(() => {
    const map: Record<string, Row[]> = {};
    for (const t of CABIN_TYPES) map[t] = [];
    for (const l of (job ?? cloneFrom)?.lines ?? []) {
      if (!map[l.cabin_type]) map[l.cabin_type] = [];
      map[l.cabin_type].push({
        _key: makeKey(),
        item_id: l.item_id,
        item_code: l.item_code,
        item_name: l.item_name,
        item_family: l.item_family,
        uom: l.uom,
        qty: l.qty || 1,
      });
    }
    // Re-link saved Cover rows back to their source rows so qty stays in sync
    // when editing an existing job. Covers: Support (Glass) -> its Cover, and
    // GLASS Front Wall (RHS/LHS) -> Front Cover.
    const COVER_PAIRS: Array<[string, string, (n: string) => string]> = [
      ["Bottom Support (Glass)", "Bottom Support (Glass) Cover", coverNameFor],
      ["Top Support (Glass)", "Top Support (Glass) Cover", coverNameFor],
      ["Front Wall RHS", FRONT_COVER_TYPE, frontCoverNameFor],
      ["Front Wall LHS", FRONT_COVER_TYPE, frontCoverNameFor],
    ];
    for (const [sourceType, coverType, nameOf] of COVER_PAIRS) {
      for (const cr of map[coverType] ?? []) {
        if (!cr.item_name || cr.linkedTo) continue;
        const sr = (map[sourceType] ?? []).find(
          (s) => s.item_name && nameOf(s.item_name) === cr.item_name,
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

  /** Apply an AI sketch read: set the Job Order (if matched) and replace the item
   *  rows with the resolved panels, grouped by cabin type, for the engineer to review. */
  const applyAutofill = (data: CabinAutofillData) => {
    if (data.job_order) {
      setJobNumber(data.job_order.job_number);
      setCustomerName(data.job_order.customer_name);
    }
    setRowsByType(() => {
      const map: Record<string, Row[]> = {};
      for (const t of CABIN_TYPES) map[t] = [];
      for (const r of data.rows) {
        if (!map[r.cabin_type]) map[r.cabin_type] = [];
        map[r.cabin_type].push({
          _key: makeKey(),
          item_id: r.item_id,
          item_code: r.item_code,
          item_name: r.item_name,
          item_family: r.item_family,
          uom: r.uom,
          qty: r.qty || 1,
        });
      }
      return map;
    });
  };

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
    const coverType = coverTypeForSource(type);
    if (!coverType) return;
    const qty = (rowsByType[type] ?? []).find((r) => r._key === key)?.qty || 1;

    const applyCover = (
      cover: { id: string; code: string; name: string; uom: string } | null,
    ) =>
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

    // A pick with no matching cover (e.g. a non-GLASS Front Wall item) drops any
    // previously auto-added cover linked to this row.
    const coverName = coverNameForSource(type, it.name);
    if (!coverName) {
      applyCover(null);
      return;
    }
    getCabinItemByName(coverName).then(applyCover);
  };

  const clearItem = (type: string, key: string) => {
    setRows(type, (rs) =>
      rs.map((r) =>
        r._key === key
          ? { ...r, item_id: null, item_code: null, item_name: null, uom: null }
          : r,
      ),
    );
    const coverType = coverTypeForSource(type);
    if (coverType) setRows(coverType, (rs) => rs.filter((r) => r.linkedTo !== key));
  };

  const setQty = (type: string, key: string, q: number) => {
    setRows(type, (rs) => rs.map((r) => (r._key === key ? { ...r, qty: q } : r)));
    const coverType = coverTypeForSource(type);
    if (coverType)
      setRows(coverType, (rs) => rs.map((r) => (r.linkedTo === key ? { ...r, qty: q } : r)));
  };

  const removeRow = (type: string, key: string) => {
    setRows(type, (rs) => rs.filter((r) => r._key !== key));
    const coverType = coverTypeForSource(type);
    if (coverType) setRows(coverType, (rs) => rs.filter((r) => r.linkedTo !== key));
  };

  const totalItems = Object.values(rowsByType)
    .flat()
    .filter((r) => r.item_id).length;

  // Live sketch model: the CURRENT edited rows (not just what's saved), so the
  // engineer reviews exactly what would be saved.
  const sketchLines = useMemo<CabinJobLine[]>(
    () =>
      CABIN_TYPES.flatMap((type) =>
        (rowsByType[type] ?? [])
          .filter((r) => r.item_id)
          .map((r, i) => ({
            id: r._key,
            cabin_type: type,
            item_id: r.item_id,
            item_code: r.item_code,
            item_name: r.item_name,
            item_family: r.item_family ?? null,
            uom: r.uom,
            qty: r.qty,
            sort_order: i,
          })),
      ),
    [rowsByType],
  );

  // AI-draft review state (optimistic overlay over the server prop).
  const [justReviewed, setJustReviewed] = useState(false);
  const isDraft = isEditing && !!job && job.reviewed_at == null && !justReviewed;
  const markReviewed = () => {
    if (!job) return;
    startTransition(async () => {
      const res = await setCabinJobReviewed(job.id, true);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setJustReviewed(true);
      toast.success(`${job.job_number} marked reviewed — it now counts in the cabin requirement.`);
      router.refresh();
    });
  };

  // stay = save but keep editing this job (don't leave for the list).
  const save = (stay = false) => {
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
        ? await updateCabinJob(job!.id, { job_number: jobNumber, customer_name: customerName, lines })
        : await createCabinJob({ job_number: jobNumber, customer_name: customerName, lines });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (stay) {
        toast.success(`Cabin job ${jobNumber} saved.`);
        // On first save of a new job, switch into edit mode for the saved job
        // so further saves update it instead of creating a duplicate.
        if (!isEditing && res.id) router.replace(`/cabin-jobs/${res.id}`);
        router.refresh();
      } else {
        router.push("/cabin-jobs");
        router.refresh();
      }
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
      <Link
        href="/cabin-jobs"
        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Cabin Jobs
      </Link>
      <PageHeader
        icon={<Container size={18} />}
        title={isEditing ? `Cabin Job ${job!.job_number}` : "New Cabin Job"}
        actions={
          <>
            {isEditing && (
              <Link href={`/cabin-jobs/new?from=${job!.id}`} title="Clone this job into a new one">
                <Button size="sm" variant="secondary">
                  <Copy className="h-4 w-4 mr-1.5" /> Clone
                </Button>
              </Link>
            )}
            {isEditing && (
              <Button size="sm" variant="destructive" onClick={onDelete} disabled={isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => save(true)} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              Save
            </Button>
            <Button size="sm" onClick={() => save(false)} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              {isEditing ? "Save & Close" : "Create cabin job"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-3 p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
          {error}
        </div>
      )}

      {cloning && (
        <div className="mb-3 p-3 text-sm bg-[var(--info-bg,var(--muted))] text-[var(--foreground)] rounded-md border border-[var(--border)] inline-flex items-center gap-1.5">
          <Copy className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          Cloned from <strong>{cloneFrom!.job_number}</strong> — pick its Job
          Order, adjust items, and save as a separate job.
        </div>
      )}

      {/* Header field — a cabin job must point at a real Job Order */}
      <div className="card-surface p-3 mb-3 max-w-md">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
          Job Order <span className="text-[var(--destructive)]">*</span>
        </label>
        <CabinJobOrderPicker
          value={jobNumber}
          customer={customerName}
          autoFocus={!isEditing}
          onPick={(j) => {
            setJobNumber(j.job_number);
            setCustomerName(j.customer_name);
          }}
          onClear={() => {
            setJobNumber("");
            setCustomerName(null);
          }}
        />
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
          Pick the matching Job Order — cabin jobs must link to one. Not listed? Create it in Jobs first.
        </p>
      </div>

      {/* AI: upload a hand sketch → resolve panels → pre-fill the rows below */}
      {!isEditing && <CabinSketchAutofill onApply={applyAutofill} />}

      {/* AI-draft review banner — drafts are excluded from cabin demand until reviewed */}
      {isDraft && (
        <div className="mb-3 p-3 rounded-md border border-amber-300 bg-amber-50 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px] text-sm text-amber-900">
            <strong>AI-drafted cabin job — pending review.</strong>{" "}
            Check the sketch and items below (the job note lists every assumption and
            blank). Draft items are <em>excluded</em> from the cabin requirement and
            cutting plans until you mark this reviewed.
          </div>
          <Button size="sm" onClick={markReviewed} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            Mark reviewed
          </Button>
        </div>
      )}

      {/* Hand-sketch-style plan view of the current items — review at a glance */}
      {totalItems > 0 && (
        <div className="mb-3">
          <CabinSketchView
            jobNumber={jobNumber || job?.job_number || "—"}
            customerName={customerName}
            lines={sketchLines}
          />
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mb-3">
        {totalItems} item{totalItems === 1 ? "" : "s"} added across{" "}
        {CABIN_TYPES.length} types. Picking a Bottom/Top Support (Glass) item
        auto-adds its matching Cover.
      </p>

      {/* One block per cabin type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {CABIN_TYPES.map((type) => {
          const rows = rowsByType[type] ?? [];
          const picked = rows.filter((r) => r.item_id).length;
          return (
            // overflow-visible: let the item-search dropdown escape the card
            // (the default Card clips it, cropping the results — see picker menus).
            <Card key={type} className="overflow-visible">
              <SectionHeader
                title={type}
                count={picked > 0 ? `· ${picked}` : undefined}
                className="rounded-t-[var(--radius)]"
              />
              <div className="p-3">
                {rows.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {rows.map((row) => (
                      <div key={row._key} className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          {row.auto ? (
                            <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-[var(--success-border)] bg-[var(--success-bg)] min-w-0">
                              <Link2 className="h-3 w-3 text-[var(--success)] shrink-0" />
                              <span className="text-sm font-medium truncate flex-1">
                                {row.item_name}
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-[var(--success)] shrink-0">
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
                              initialFamily={row.item_family}
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
                        <Input
                          size="sm"
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
                          className="w-20 text-right shrink-0"
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
                            className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer"
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}
