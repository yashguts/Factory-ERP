// Pure helpers for the Job status-change alert system. No server/client deps so
// both the server actions and the UI compute alert state identically.
import type { JobStatus } from "@/lib/supabase/types";

export type StatusAlertKind = "started" | "held" | "reverted" | "resumed";

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  in_production: "In Production",
  hold: "Hold",
};

export const statusLabel = (s: string | null | undefined): string =>
  (s && STATUS_LABELS[s as JobStatus]) || (s ?? "—");

/**
 * The factory-critical transition for a status change, or null when the change
 * isn't one of the four alerting transitions (it's still logged in history).
 *   new -> in_production  : started
 *   in_production -> hold : held      (reason required)
 *   in_production -> new  : reverted  (reason required)
 *   hold -> in_production : resumed
 */
export function alertKind(from: JobStatus | null, to: JobStatus): StatusAlertKind | null {
  if (from === to) return null;
  if (from === "new" && to === "in_production") return "started";
  if (from === "in_production" && to === "hold") return "held";
  if (from === "in_production" && to === "new") return "reverted";
  if (from === "hold" && to === "in_production") return "resumed";
  return null;
}

export interface AlertMeta {
  label: string; // full label, e.g. "Put on Hold"
  short: string; // chip text
  icon: string;
  tone: "green" | "red" | "amber" | "blue";
  requiresReason: boolean;
}

export const ALERT_META: Record<StatusAlertKind, AlertMeta> = {
  started: { label: "Production Started", short: "Started", icon: "▶", tone: "green", requiresReason: true },
  held: { label: "Put on Hold", short: "Held", icon: "⏸", tone: "red", requiresReason: true },
  reverted: { label: "Reverted to New", short: "Reverted", icon: "↩", tone: "amber", requiresReason: true },
  resumed: { label: "Production Resumed", short: "Resumed", icon: "▶", tone: "blue", requiresReason: true },
};

/**
 * Whether a transition needs a reason captured. Per management (2026-07-09):
 * EVERY real status change requires a written reason — not just Hold/Revert.
 * (ALERT_META.requiresReason is kept true across the board for the UI copy;
 * this helper is the single gate both the actions and the UI consult.)
 */
export function reasonRequired(from: JobStatus | null, to: JobStatus): boolean {
  return from !== null && from !== to;
}
