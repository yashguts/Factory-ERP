/**
 * Site surveys from Construction (the LT AMC Construction module).
 *
 * When a site survey is submitted in Construction, cx_record_site_survey
 * (migration 076) stores it in cx_site_surveys: one row per (job, survey_ref),
 * the whole survey in `payload` (version 1). The job page shows the newest
 * survey (by submitted_at) in full and keeps the earlier ones as history.
 *
 * The payload comes from another system, so everything here parses it
 * defensively (missing or odd fields fall back instead of breaking the page),
 * and only https media links are ever rendered.
 *
 * Pure presentation + decision helpers. No imports on purpose, so
 * scripts/verify-site-survey.ts can run this file directly under Node.
 */

/** A row as the server action returns it (payload untouched). */
export interface SiteSurveyRow {
  id: string;
  survey_ref: string;
  survey_no: number | null;
  overall_result: string | null;
  submitted_at: string;
  received_at: string;
  updated_at: string | null;
  payload: unknown;
}

/** `ok: false` only when the read itself failed ("couldn't check"). */
export type SiteSurveyRead =
  | { ok: true; surveys: SiteSurveyRow[] }
  | { ok: false; error: string };

export type CheckpointResult = "YES" | "NO" | null;

export interface SurveyCheckpointView {
  key: string;
  label: string;
  /** "OK", "Not ready", … as Construction labels it; "Not checked" if missing. */
  statusLabel: string;
  result: CheckpointResult;
  remark: string | null;
}

export interface SurveyMediaView {
  kind: "photo" | "video";
  url: string;
  checkpointLabel: string | null;
  capturedAt: string | null;
  durationMs: number | null;
}

/** One survey, normalised for display. */
export interface SiteSurveyView {
  id: string;
  surveyRef: string;
  surveyNo: number | null;
  kind: string | null;
  overallResult: string | null;
  overallLabel: string | null;
  surveyedBy: string | null;
  submittedAt: string;
  distanceM: number | null;
  accuracyM: number | null;
  expectedReadyDate: string | null;
  note: string | null;
  retrospective: boolean;
  checkpoints: SurveyCheckpointView[];
  photos: SurveyMediaView[];
  videos: SurveyMediaView[];
}

/* ---- defensive readers ------------------------------------------------- */

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Only https links are rendered (they go into href / src). */
function safeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/* ---- labels ------------------------------------------------------------ */

export const OVERALL_LABEL: Record<string, string> = {
  READY: "Ready",
  PARTIAL: "Partially ready",
  NOT_READY: "Not ready",
};

/** Label for an overall result; null when missing or unknown. */
export function overallLabelOf(result: string | null | undefined): string | null {
  if (!result || !Object.prototype.hasOwnProperty.call(OVERALL_LABEL, result)) return null;
  return OVERALL_LABEL[result];
}

export type SurveyTone = "ready" | "partial" | "not_ready" | "none";

/** Heading colour: green READY, amber PARTIAL, red NOT_READY. */
export function surveyTone(result: string | null | undefined): SurveyTone {
  return result === "READY"
    ? "ready"
    : result === "PARTIAL"
      ? "partial"
      : result === "NOT_READY"
        ? "not_ready"
        : "none";
}

/** ✓ green for YES (Ready/OK), ✗ red for NO (Not ready/Not OK), — grey otherwise. */
export function checkpointTick(result: CheckpointResult | string | null | undefined): {
  symbol: "✓" | "✗" | "—";
  tone: "yes" | "no" | "none";
  label: string;
} {
  if (result === "YES") return { symbol: "✓", tone: "yes", label: "Ready / OK" };
  if (result === "NO") return { symbol: "✗", tone: "no", label: "Not ready / Not OK" };
  return { symbol: "—", tone: "none", label: "Not checked" };
}

/* ---- normalise --------------------------------------------------------- */

export function toSurveyView(row: SiteSurveyRow): SiteSurveyView {
  const p = asObj(row.payload);
  const result = str(row.overall_result) ?? str(p.overall_result);

  const checkpoints: SurveyCheckpointView[] = (Array.isArray(p.checkpoints) ? p.checkpoints : [])
    .map(asObj)
    .map((c, i) => {
      const raw = str(c.result);
      const cpResult: CheckpointResult = raw === "YES" || raw === "NO" ? raw : null;
      return {
        key: str(c.key) ?? `cp-${i}`,
        label: str(c.label) ?? str(c.key) ?? "Checkpoint",
        statusLabel: str(c.status_label) ?? (cpResult === null ? "Not checked" : cpResult === "YES" ? "OK" : "Not OK"),
        result: cpResult,
        remark: str(c.remark),
      };
    });

  const media: SurveyMediaView[] = [];
  for (const m of (Array.isArray(p.media) ? p.media : []).map(asObj)) {
    const kind = m.kind === "photo" || m.kind === "video" ? m.kind : null;
    const url = safeUrl(m.url);
    if (!kind || !url) continue;
    media.push({
      kind,
      url,
      checkpointLabel: str(m.checkpoint_label),
      capturedAt: str(m.captured_at),
      durationMs: num(m.duration_ms),
    });
  }

  return {
    id: row.id,
    surveyRef: row.survey_ref,
    surveyNo: row.survey_no ?? num(p.survey_no),
    kind: str(p.kind),
    overallResult: result,
    overallLabel: str(p.overall_label) ?? overallLabelOf(result),
    surveyedBy: str(p.surveyed_by),
    submittedAt: row.submitted_at ?? str(p.submitted_at) ?? "",
    distanceM: num(p.distance_m),
    accuracyM: num(p.accuracy_m),
    expectedReadyDate: str(p.expected_ready_date),
    note: str(p.note),
    retrospective: p.retrospective === true,
    checkpoints,
    photos: media.filter((m) => m.kind === "photo"),
    videos: media.filter((m) => m.kind === "video"),
  };
}

/** Newest survey (by submitted_at) on top; the rest, newest first, as history. */
export function splitSurveys(surveys: readonly SiteSurveyView[]): {
  latest: SiteSurveyView | null;
  earlier: SiteSurveyView[];
} {
  const sorted = [...surveys].sort((a, b) => {
    const d = timeOf(b.submittedAt) - timeOf(a.submittedAt);
    return Number.isNaN(d) ? 0 : d;
  });
  return { latest: sorted[0] ?? null, earlier: sorted.slice(1) };
}

/* ---- texts ------------------------------------------------------------- */

export const SURVEY_CARD_TITLE = "Site survey (Construction)";
export const NO_SURVEY_TEXT = "No site survey from Construction yet.";
export const SURVEY_READ_FAILED_TEXT = "Couldn't read the site survey from Construction just now.";
export const RETROSPECTIVE_TEXT = "Recorded as completed without a site visit";

/** "Site survey #1 — Ready" (the number / label left out when missing). */
export function surveyHeading(s: Pick<SiteSurveyView, "surveyNo" | "overallLabel">): string {
  return `Site survey${s.surveyNo != null ? ` #${s.surveyNo}` : ""}${s.overallLabel ? ` — ${s.overallLabel}` : ""}`;
}

/** Date and time in the viewer's locale, like the rest of the job page. */
export function formatSurveyDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A date-only value ("2026-10-15") shown as that calendar day in any time zone. */
export function formatSurveyDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "12 m from the site" (rounded), or null without a usable distance. */
export function distanceText(distanceM: number | null | undefined): string | null {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 0) return null;
  return `${Math.round(distanceM).toLocaleString("en-IN")} m from the site`;
}

/** "by Sourav Sardar · 29 Sept 2026, 11:17 pm · 12 m from the site", leaving out missing parts. */
export function surveyByLine(
  s: Pick<SiteSurveyView, "surveyedBy" | "submittedAt" | "distanceM">,
  formatDateTime: (iso: string) => string = formatSurveyDateTime,
): string {
  return [
    s.surveyedBy ? `by ${s.surveyedBy}` : null,
    s.submittedAt ? formatDateTime(s.submittedAt) : null,
    distanceText(s.distanceM),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Expected ready by 15 Oct 2026", or null when no date was given. */
export function expectedReadyText(
  s: Pick<SiteSurveyView, "expectedReadyDate">,
  formatDate: (date: string) => string = formatSurveyDate,
): string | null {
  return s.expectedReadyDate ? `Expected ready by ${formatDate(s.expectedReadyDate)}` : null;
}

/** 14000 → "0:14"; 3723000 → "1:02:03"; missing → "". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "Video · 0:14" (just "Video" without a duration). */
export function videoCaption(m: Pick<SurveyMediaView, "durationMs">): string {
  const d = formatDuration(m.durationMs);
  return d ? `Video · ${d}` : "Video";
}

export function earlierSurveysLabel(n: number): string {
  return `Earlier surveys (${n})`;
}
