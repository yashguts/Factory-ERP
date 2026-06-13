/**
 * Shared dispatch-progress vocabulary so every surface (the Dispatch panel, the
 * job-detail Section/Item views, and the Mark-Dispatch modal) reads identically.
 *
 * Owner-locked terminology (2026-06-13):
 *   - numbers : Required / Dispatched / Remaining
 *   - status  : Pending / Partial (x/y) / Dispatched
 *   - phases  : "1st phase" / "2nd phase"  (see project-dispatch-phase-model)
 *
 * Presentation only — no business logic. "Remaining" per BOM line stays
 * required − dispatched, exactly as the data layer computes it.
 */

export type DispatchTone = "pending" | "partial" | "done";

export interface DispatchStat {
  total: number; // lines in the group
  done: number; // lines with nothing remaining
  tone: DispatchTone;
  label: string; // "Pending" | "Partial (2/5)" | "Dispatched"
}

/** Roll a set of lines (a phase, a section, a whole job) up to one status.
 *  Each line only needs a `remaining`. Returns null for an empty group. */
export function dispatchStat(lines: { remaining: number }[]): DispatchStat | null {
  if (lines.length === 0) return null;
  const total = lines.length;
  const done = lines.filter((l) => l.remaining <= 0).length;
  const tone: DispatchTone =
    done === 0 ? "pending" : done >= total ? "done" : "partial";
  const label =
    done === 0
      ? "Pending"
      : done >= total
        ? "Dispatched"
        : `Partial (${done}/${total})`;
  return { total, done, tone, label };
}

/** Inline text color for a status word. */
export function toneText(tone: DispatchTone | null | undefined): string {
  return tone === "done"
    ? "text-green-600"
    : tone === "partial"
      ? "text-amber-600"
      : "text-[var(--muted-foreground)]";
}

/** Pill classes (text + bg + border) for a status chip. */
export function toneChip(tone: DispatchTone | null | undefined): string {
  return tone === "done"
    ? "text-green-700 bg-green-50 border-green-200"
    : tone === "partial"
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : "text-[var(--muted-foreground)] bg-[var(--muted)] border-[var(--border)]";
}
