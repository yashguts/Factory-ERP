/**
 * Site surveys from Construction (the LT AMC Construction module).
 *
 * When a site survey is submitted in Construction, cx_record_site_survey
 * (migration 076) stores it in cx_site_surveys: one row per (job, survey_ref),
 * the whole survey in `payload`. The job page shows the newest survey (by
 * submitted_at) in full and keeps the earlier ones as history.
 *
 * Payload version 2 is a superset of version 1: every point may carry YES / NO
 * sub-points (checkpoints[i].subpoints) and media may belong to a sub-point
 * (media[j].subpoint / subpoint_label). A version-1 payload has neither, and
 * renders exactly as before.
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

/** A YES / NO sub-point of a survey point (payload version 2). */
export interface SurveySubpointView {
  key: string;
  label: string;
  answer: CheckpointResult;
}

export interface SurveyCheckpointView {
  key: string;
  label: string;
  /** "OK", "Not ready", … as Construction labels it; "Not checked" if missing. */
  statusLabel: string;
  result: CheckpointResult;
  remark: string | null;
  /** In order; [] for version-1 surveys. */
  subpoints: SurveySubpointView[];
}

export interface SurveyMediaView {
  kind: "photo" | "video";
  url: string;
  checkpointKey: string | null;
  checkpointLabel: string | null;
  /** The sub-point this photo / video belongs to (version 2), else null. */
  subpointKey: string | null;
  subpointLabel: string | null;
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

/** A sub-point's ✓ / ✗ / —: same colours as a point, answer-worded label. */
export function answerTick(answer: CheckpointResult | string | null | undefined): {
  symbol: "✓" | "✗" | "—";
  tone: "yes" | "no" | "none";
  label: string;
} {
  if (answer === "YES") return { symbol: "✓", tone: "yes", label: "Yes" };
  if (answer === "NO") return { symbol: "✗", tone: "no", label: "No" };
  return { symbol: "—", tone: "none", label: "Not checked" };
}

function yesNo(v: unknown): CheckpointResult {
  const s = str(v);
  return s === "YES" || s === "NO" ? s : null;
}

/* ---- normalise --------------------------------------------------------- */

export function toSurveyView(row: SiteSurveyRow): SiteSurveyView {
  const p = asObj(row.payload);
  const result = str(row.overall_result) ?? str(p.overall_result);

  const checkpoints: SurveyCheckpointView[] = (Array.isArray(p.checkpoints) ? p.checkpoints : [])
    .map(asObj)
    .map((c, i) => {
      const cpResult = yesNo(c.result);
      const key = str(c.key) ?? `cp-${i}`;
      return {
        key,
        label: str(c.label) ?? str(c.key) ?? "Checkpoint",
        statusLabel: str(c.status_label) ?? (cpResult === null ? "Not checked" : cpResult === "YES" ? "OK" : "Not OK"),
        result: cpResult,
        remark: str(c.remark),
        subpoints: (Array.isArray(c.subpoints) ? c.subpoints : []).map(asObj).map((s, j) => ({
          key: str(s.key) ?? `${key}-sub-${j}`,
          label: str(s.label) ?? str(s.key) ?? "Sub-point",
          answer: yesNo(s.answer) ?? yesNo(s.result),
        })),
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
      checkpointKey: str(m.checkpoint),
      checkpointLabel: str(m.checkpoint_label),
      subpointKey: str(m.subpoint),
      subpointLabel: str(m.subpoint_label),
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

/** The sub-points listed under a point: only when it has 2 or more. A point
 *  with a single sub-point (e.g. OTHER_INFRA) means the same as the point, so
 *  its own ✓ / ✗ is enough. */
export function nestedSubpoints(cp: Pick<SurveyCheckpointView, "subpoints">): SurveySubpointView[] {
  return cp.subpoints.length >= 2 ? cp.subpoints : [];
}

/** Photos and videos of one sub-point, shown together under one caption. */
export interface SurveyMediaGroup {
  key: string;
  caption: string;
  photos: SurveyMediaView[];
  videos: SurveyMediaView[];
}

/** Find the point and sub-point a media item belongs to (by its point key,
 *  or by the sub-point key alone when the point key is missing). */
function findSubpoint(
  checkpoints: readonly SurveyCheckpointView[],
  m: Pick<SurveyMediaView, "checkpointKey" | "subpointKey">,
): { cp: SurveyCheckpointView | null; sp: SurveySubpointView | null } {
  for (const cp of checkpoints) {
    if (m.checkpointKey && cp.key !== m.checkpointKey) continue;
    const sp = cp.subpoints.find((s) => s.key === m.subpointKey);
    if (sp) return { cp, sp };
  }
  return { cp: checkpoints.find((c) => c.key === m.checkpointKey) ?? null, sp: null };
}

/** "<point label> · <sub-point label>". A point with a single sub-point means
 *  the same as its sub-point, so just the point label then. */
export function mediaGroupCaption(
  checkpoints: readonly SurveyCheckpointView[],
  m: Pick<SurveyMediaView, "checkpointKey" | "checkpointLabel" | "subpointKey" | "subpointLabel">,
): string {
  const { cp, sp } = findSubpoint(checkpoints, m);
  const point = m.checkpointLabel ?? cp?.label ?? null;
  const sub = m.subpointLabel ?? sp?.label ?? m.subpointKey;
  if (cp && cp.subpoints.length === 1 && point) return point;
  return [point, sub].filter(Boolean).join(" · ");
}

/** Media grouped under their sub-point (in point / sub-point order, unknown
 *  ones after, in the order sent); media without a sub-point — every
 *  version-1 photo and video — stay in the plain photo and video grids. */
export function groupSurveyMedia(s: Pick<SiteSurveyView, "checkpoints" | "photos" | "videos">): {
  groups: SurveyMediaGroup[];
  photos: SurveyMediaView[];
  videos: SurveyMediaView[];
} {
  const rank = new Map<string, number>();
  for (const cp of s.checkpoints)
    for (const sp of cp.subpoints) if (!rank.has(sp.key)) rank.set(sp.key, rank.size);

  const groups = new Map<string, SurveyMediaGroup & { order: number }>();
  const photos: SurveyMediaView[] = [];
  const videos: SurveyMediaView[] = [];
  for (const m of [...s.photos, ...s.videos]) {
    if (!m.subpointKey) {
      (m.kind === "photo" ? photos : videos).push(m);
      continue;
    }
    const key = `${m.checkpointKey ?? findSubpoint(s.checkpoints, m).cp?.key ?? ""}::${m.subpointKey}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        caption: mediaGroupCaption(s.checkpoints, m),
        photos: [],
        videos: [],
        order: rank.get(m.subpointKey) ?? rank.size + groups.size,
      };
      groups.set(key, g);
    }
    (m.kind === "photo" ? g.photos : g.videos).push(m);
  }
  return {
    groups: [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ key: g.key, caption: g.caption, photos: g.photos, videos: g.videos })),
    photos,
    videos,
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
