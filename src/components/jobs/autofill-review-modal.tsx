"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfidenceBadge, Provenance } from "@/components/jobs/confidence-badge";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import type {
  AutofillResult,
  AppliedSuggestion,
  Confidence,
  SuggestedLine,
  SpecSuggestion,
} from "@/components/jobs/autofill-types";
import { Sparkles, AlertTriangle } from "lucide-react";

export interface ApplyPayload {
  spec: {
    floors?: number | null;
    drive_type?: string | null;
    capacity?: string | null;
    door_finish?: string | null;
    brand?: string | null;
  };
  sections: Record<string, PickedItem[]>;
  applied: AppliedSuggestion[];
}

const SPEC_FIELDS: { key: keyof SpecSuggestion; label: string }[] = [
  { key: "drive_type", label: "Drive Type" },
  { key: "floors", label: "Floors" },
  { key: "capacity", label: "Capacity" },
  { key: "door_finish", label: "Door Finish" },
  { key: "brand", label: "Brand" },
];

const rid = () => Math.random().toString(36).slice(2);
const preChecked = (c: Confidence) => c !== "low"; // low-confidence is opt-in

export function AutofillReviewModal({
  result,
  onApply,
  onClose,
}: {
  result: AutofillResult;
  onApply: (p: ApplyPayload) => void;
  onClose: () => void;
}) {
  // ── spec selection ──
  const specInit: Record<string, boolean> = {};
  if (result.spec)
    for (const f of SPEC_FIELDS) {
      const cell = result.spec[f.key];
      if (cell && cell.value != null) specInit[f.key] = preChecked(cell.confidence);
    }
  const [specChecked, setSpecChecked] = useState(specInit);

  // ── bom selection + edited qty ──
  const linesByPhase = useMemo(() => {
    const m = new Map<string, Map<string, SuggestedLine[]>>();
    for (const l of result.bom) {
      const ph = m.get(l.phase) ?? new Map<string, SuggestedLine[]>();
      const arr = ph.get(l.section) ?? [];
      arr.push(l);
      ph.set(l.section, arr);
      m.set(l.phase, ph);
    }
    return m;
  }, [result.bom]);

  const [lineChecked, setLineChecked] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const l of result.bom) o[l.item_id + "@" + l.section] = preChecked(l.confidenceBand);
    return o;
  });
  const [qtyEdit, setQtyEdit] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    for (const l of result.bom) o[l.item_id + "@" + l.section] = l.suggestedQty;
    return o;
  });

  const checkedCount =
    Object.values(specChecked).filter(Boolean).length + Object.values(lineChecked).filter(Boolean).length;

  function apply() {
    const applied: AppliedSuggestion[] = [];
    const spec: ApplyPayload["spec"] = {};
    if (result.spec) {
      for (const f of SPEC_FIELDS) {
        const cell = result.spec[f.key];
        if (!cell || cell.value == null || !specChecked[f.key]) continue;
        if (f.key === "floors") spec.floors = Number(cell.value);
        else (spec as Record<string, unknown>)[f.key] = cell.value;
        applied.push({
          kind: "spec",
          field: f.key,
          suggested_value: String(cell.value),
          suggested_qty: null,
          confidence: cell.confidence,
          provenance: [],
        });
      }
    }
    const sections: Record<string, PickedItem[]> = {};
    for (const l of result.bom) {
      const key = l.item_id + "@" + l.section;
      if (!lineChecked[key]) continue;
      const qty = qtyEdit[key] ?? l.suggestedQty;
      (sections[l.section] ??= []).push({
        _key: rid(),
        item_id: l.item_id,
        item_code: l.item_code,
        item_name: l.item_name,
        item_lookup: null,
        uom: l.uom,
        category_name: null,
        required_quantity: qty,
      });
      applied.push({
        kind: "bom_line",
        field: l.section,
        suggested_value: l.item_id,
        suggested_qty: qty,
        confidence: l.confidenceBand,
        provenance: l.supportingJobs,
      });
    }
    onApply({ spec, sections, applied });
  }

  return (
    <Modal title="AI Auto-fill — review & apply" onClose={onClose} className="max-w-3xl">
      <div className="space-y-3">
        <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
          <Sparkles size={13} className="text-[var(--primary)]" />
          {result.drawingRead
            ? "Read from the drawing + matched against your most similar past jobs."
            : "Drawing-reading isn't switched on yet — these come from the spec you entered + your similar past jobs."}
          {" "}Low-confidence rows are unchecked by default — you opt in.
        </p>

        {result.warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2 text-xs px-3 py-2 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {w}
          </div>
        ))}

        {/* Spec block */}
        {result.spec && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">
              Specification
            </h3>
            <div className="space-y-1">
              {SPEC_FIELDS.map((f) => {
                const cell = result.spec![f.key];
                if (!cell || cell.value == null) return null;
                return (
                  <label key={f.key} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!specChecked[f.key]}
                      onChange={(e) => setSpecChecked((p) => ({ ...p, [f.key]: e.target.checked }))}
                      className="cursor-pointer"
                    />
                    <span className="w-28 text-[var(--muted-foreground)]">{f.label}</span>
                    <span className="font-medium">{String(cell.value)}</span>
                    <ConfidenceBadge level={cell.confidence} title={cell.rationale} />
                    <span className="text-[10px] text-[var(--muted-foreground)] truncate">{cell.rationale}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Read from the drawing — read-only facts the predictor used */}
        {result.drawingReads && result.drawingReads.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">
              Read from the drawing
            </h3>
            <p className="text-[10px] text-[var(--muted-foreground)] mb-1.5">
              What the AI read straight off the GA — these aren&apos;t applied, they feed the BOM + the manual sections below. Check anything that looks off.
            </p>
            <div className="space-y-1">
              {result.drawingReads.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="w-40 shrink-0 text-[var(--muted-foreground)]">{r.label}</span>
                  <span className="font-medium">{r.value}</span>
                  {r.confidence && <ConfidenceBadge level={r.confidence} />}
                  {r.note && <span className="text-[10px] text-[var(--muted-foreground)] truncate">{r.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BOM block */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">
            Bill of materials · {result.bom.length} suggested line{result.bom.length === 1 ? "" : "s"}
          </h3>
          {result.bom.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No BOM suggestions for this spec.</p>
          ) : (
            <div className="space-y-3">
              {[...linesByPhase.entries()].map(([phase, sections]) => (
                <div key={phase}>
                  <div className="text-[11px] font-semibold text-[var(--foreground)] mb-1">{phase}</div>
                  {[...sections.entries()].map(([section, lines]) => (
                    <div key={section} className="mb-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{section}</div>
                      {lines.map((l) => {
                        const key = l.item_id + "@" + l.section;
                        const low = l.confidenceBand === "low";
                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-2 text-sm py-1 px-2 rounded ${low ? "bg-[var(--destructive-bg)]/50" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={!!lineChecked[key]}
                              onChange={(e) => setLineChecked((p) => ({ ...p, [key]: e.target.checked }))}
                              className="cursor-pointer"
                            />
                            <span className="flex-1 min-w-0 truncate">{l.item_name}</span>
                            <ConfidenceBadge level={l.confidenceBand} />
                            <Provenance jobs={l.supportingJobs} />
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              step="any"
                              value={qtyEdit[key]}
                              onChange={(e) => setQtyEdit((p) => ({ ...p, [key]: Number(e.target.value) }))}
                              className="w-16 text-right"
                            />
                            <span className="w-8 text-[11px] text-[var(--muted-foreground)]">{l.uom}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Left for you to fill — suppressed sections + drawing-derived hints */}
        {result.manualSections && result.manualSections.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">
              Left for you to fill · {result.manualSections.length} section{result.manualSections.length === 1 ? "" : "s"}
            </h3>
            <p className="text-[10px] text-[var(--muted-foreground)] mb-1.5">
              These aren&apos;t auto-filled on purpose — the drawing doesn&apos;t reliably carry them. Here&apos;s what it did show, to speed your manual entry.
            </p>
            <div className="space-y-2">
              {result.manualSections.map((m) => (
                <div key={m.section} className="rounded-md border border-[var(--border)] px-3 py-2">
                  <div className="text-[11px] font-semibold text-[var(--foreground)]">{m.section}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)] mb-1">{m.reason}</div>
                  {m.hints.map((h, i) => (
                    <div key={i} className="flex gap-2 text-xs py-0.5">
                      <span className="w-24 shrink-0 text-[var(--muted-foreground)]">{h.label}</span>
                      <span className="font-medium">{h.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--border)]">
        <span className="text-xs text-[var(--muted-foreground)]">
          Low-confidence rows are unchecked by default. Nothing is saved until you Save the job.
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={checkedCount === 0}>
            Apply {checkedCount} selected
          </Button>
        </div>
      </div>
    </Modal>
  );
}
