"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Info } from "lucide-react";
import { getJobSiteSurveys } from "@/lib/actions/site-surveys";
import {
  NO_SURVEY_TEXT,
  RETROSPECTIVE_TEXT,
  SURVEY_CARD_TITLE,
  SURVEY_READ_FAILED_TEXT,
  checkpointTick,
  earlierSurveysLabel,
  expectedReadyText,
  splitSurveys,
  surveyByLine,
  surveyHeading,
  surveyTone,
  toSurveyView,
  videoCaption,
  type SiteSurveyRead,
  type SiteSurveyView,
  type SurveyTone,
} from "@/lib/site-survey";

const HEADING_TONE: Record<SurveyTone, string> = {
  ready: "text-[var(--success)]",
  partial: "text-[var(--warning)]",
  not_ready: "text-[var(--destructive)]",
  none: "text-[var(--foreground)]",
};

const TICK_TONE = {
  yes: "text-[var(--success)]",
  no: "text-[var(--destructive)]",
  none: "text-[var(--muted-foreground)]",
} as const;

/**
 * "Site survey (Construction)" card on the job page: the newest survey sent
 * from Construction in full, earlier ones collapsed below. Client-fetched,
 * like the Dispatches panel's clearance line (written outside the ERP, so it
 * is read uncached and never slows the page open).
 */
export function SiteSurveyCard({ jobId }: { jobId: string }) {
  const [read, setRead] = useState<SiteSurveyRead | null>(null);
  useEffect(() => {
    let alive = true;
    getJobSiteSurveys(jobId)
      .then((r) => {
        if (alive) setRead(r);
      })
      .catch(() => {
        if (alive) setRead({ ok: false, error: "Could not read the site survey." });
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

  const { latest, earlier } = useMemo(
    () => splitSurveys(read?.ok ? read.surveys.map(toSurveyView) : []),
    [read],
  );

  return (
    <div className="card-surface p-2.5 mb-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-[13px] font-semibold inline-flex items-center gap-1.5">
          <ClipboardCheck className="h-3.5 w-3.5" /> {SURVEY_CARD_TITLE}
        </h3>
        {!read ? (
          <span className="text-[11px] text-[var(--muted-foreground)]">Loading…</span>
        ) : !read.ok ? (
          <span className="text-[11px] text-[var(--muted-foreground)]">{SURVEY_READ_FAILED_TEXT}</span>
        ) : !latest ? (
          <span className="text-[11px] text-[var(--muted-foreground)]">{NO_SURVEY_TEXT}</span>
        ) : null}
      </div>

      {latest && <SurveyBlock survey={latest} />}

      {earlier.length > 0 && (
        <details className="mt-3 border-t border-[var(--border)] pt-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-[var(--muted-foreground)]">
            {earlierSurveysLabel(earlier.length)}
          </summary>
          <div className="divide-y divide-[var(--border)]">
            {earlier.map((s) => (
              <div key={s.id} className="pb-2">
                <SurveyBlock survey={s} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** One survey: heading, who/when/where, checkpoints, note, photos, videos. */
function SurveyBlock({ survey }: { survey: SiteSurveyView }) {
  const byLine = surveyByLine(survey);
  const expected = expectedReadyText(survey);
  return (
    <div className="mt-2">
      <div className={`text-sm font-semibold ${HEADING_TONE[surveyTone(survey.overallResult)]}`}>
        {surveyHeading(survey)}
      </div>
      {byLine && (
        <div
          className="text-[11px] text-[var(--muted-foreground)]"
          title={survey.accuracyM != null ? `GPS accuracy ±${Math.round(survey.accuracyM)} m` : undefined}
        >
          {byLine}
        </div>
      )}
      {expected && <div className="text-[11px] font-medium">{expected}</div>}
      {survey.retrospective && (
        <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
          <Info className="h-3 w-3 shrink-0" /> {RETROSPECTIVE_TEXT}
        </div>
      )}

      {survey.checkpoints.length > 0 && (
        <ul className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
          {survey.checkpoints.map((cp) => {
            const tick = checkpointTick(cp.result);
            return (
              <li key={cp.key} className="flex items-start gap-2 px-2 py-1 text-xs">
                <span
                  className={`w-4 shrink-0 text-center font-bold ${TICK_TONE[tick.tone]}`}
                  role="img"
                  aria-label={tick.label}
                  title={tick.label}
                >
                  {tick.symbol}
                </span>
                <div className="min-w-0">
                  <span className="font-medium">{cp.label}</span>{" "}
                  <span className="text-[var(--muted-foreground)]">· {cp.statusLabel}</span>
                  {cp.remark && (
                    <div className="text-[11px] text-[var(--muted-foreground)] break-words">{cp.remark}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {survey.note && (
        <p className="mt-2 text-xs break-words">
          <span className="font-medium">Note:</span> {survey.note}
        </p>
      )}

      {survey.photos.length > 0 && (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {survey.photos.map((p, i) => (
            <a
              key={`${p.url}-${i}`}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block min-w-0"
              title={p.checkpointLabel ?? "Open the photo"}
            >
              {/* A plain <img>, not next/image: the link 307-redirects to a
                  60-second signed URL, which the image optimizer must not
                  fetch and cache. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                loading="lazy"
                alt={p.checkpointLabel ?? "Site survey photo"}
                className="aspect-square w-full rounded border border-[var(--border)] bg-[var(--muted)] object-cover"
              />
              {p.checkpointLabel && (
                <span className="mt-0.5 block truncate text-[10px] text-[var(--muted-foreground)]">
                  {p.checkpointLabel}
                </span>
              )}
            </a>
          ))}
        </div>
      )}

      {survey.videos.length > 0 && (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {survey.videos.map((v, i) => (
            <figure key={`${v.url}-${i}`} className="min-w-0">
              <video controls preload="none" src={v.url} className="aspect-video w-full rounded bg-black" />
              <figcaption className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
                {videoCaption(v)}
                {v.checkpointLabel ? ` · ${v.checkpointLabel}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
