"use client";

/**
 * "Read from photo" — the run-sheet reader for Daily Program Runs.
 *
 * Photo of the handwritten day sheet -> AI-drafted rows (matched against
 * AUDITED programs only) -> a review table where the user fixes matches,
 * adjusts counts and unticks lines -> recordRunsBulk, which goes through the
 * exact same recordRun/updateRunCount paths as manual entry. Nothing is
 * written until "Record" is pressed. Same pattern as the cabin sketch reader.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Loader2,
  X,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/utils";
import {
  draftRunsFromSheet,
  type RunSheetDraftRow,
} from "@/lib/actions/run-sheet-vision";
import {
  recordRunsBulk,
  type AuditedProgramHit,
} from "@/lib/actions/operation-runs";
import { ProgramSearch } from "@/components/programs/daily-runs-client";

interface ReviewRow extends RunSheetDraftRow {
  include: boolean;
}

/** Downscale + JPEG-recompress in the browser: handwriting survives 2000px
 *  easily, and a small payload keeps the vision call fast and cheap. */
async function fileToJpegBase64(file: File, maxDim = 2000): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return out.slice(out.indexOf(",") + 1);
}

export function RunSheetReader({ date }: { date: string }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // The day's already-logged runs by program id — keeps the "already logged"
  // badge honest even when the user swaps a row to a different program.
  const [existingMap, setExistingMap] = useState<
    Record<string, { run_id: string; runs_count: number }>
  >({});

  const onFile = async (file: File | null) => {
    if (!file) return;
    setReading(true);
    try {
      const b64 = await fileToJpegBase64(file);
      const res = await draftRunsFromSheet(b64, "image/jpeg", date);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRows(
        res.data.rows.map((r) => ({
          ...r,
          // Fresh confident matches are pre-ticked; already-logged and
          // unmatched rows need a deliberate human decision.
          include: !!r.match && !r.existing,
        })),
      );
      setExistingMap(res.data.existing_by_operation);
      setSheetDate(res.data.sheet_date_seen);
      setAiNotes(res.data.notes);
    } catch {
      toast.error("Couldn't read that photo — try a clearer one.");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setRow = (i: number, patch: Partial<ReviewRow>) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rs));

  // Every program pick (search or suggestion chip) routes through here so an
  // already-logged program regains its badge and is pre-unticked, exactly
  // like an AI-matched one.
  const pickProgram = (i: number, p: AuditedProgramHit) => {
    const ex = existingMap[p.id] ?? null;
    setRow(i, { match: p, existing: ex, include: !ex });
  };

  const commit = async () => {
    if (!rows) return;
    const picked = rows.filter((r) => r.include && r.match && r.qty > 0);
    if (!picked.length) return;
    setSaving(true);
    // Chunked: each run posts stock over several DB round-trips, and a median
    // day sheet (~15 programs) in ONE action call would exceed the serverless
    // timeout — killing the function mid-loop with rows silently half-saved.
    const CHUNK = 4;
    const outcome = { recorded: 0, updated: 0, failed: [] as { label: string; error: string }[] };
    try {
      for (let i = 0; i < picked.length; i += CHUNK) {
        const part = await recordRunsBulk(
          date,
          picked.slice(i, i + CHUNK).map((r) => ({
            operation_id: r.match!.id,
            runs_count: Math.round(r.qty),
            label: r.match!.code ?? r.match!.name,
            note: `from run sheet: "${r.as_written}"`,
          })),
        );
        outcome.recorded += part.recorded;
        outcome.updated += part.updated;
        outcome.failed.push(...part.failed);
      }
    } catch {
      toast.error(
        "Couldn't finish recording — connection or server problem. Some rows may already be saved; check the list below before retrying.",
      );
      router.refresh();
      return; // keep the modal open so nothing reviewed is lost
    } finally {
      setSaving(false);
    }
    const done = outcome.recorded + outcome.updated;
    if (outcome.failed.length) {
      const failedLabels = new Set(outcome.failed.map((f) => f.label));
      toast.error(
        `${done} saved, ${outcome.failed.length} failed (${outcome.failed
          .map((f) => f.label)
          .join(", ")}): ${outcome.failed[0].error}`,
      );
      // Keep ONLY the failed rows open for a fix-and-retry; saved rows leave.
      setRows((rs) =>
        rs
          ? rs.filter(
              (r) =>
                r.include && r.match && failedLabels.has(r.match.code ?? r.match.name),
            )
          : rs,
      );
    } else {
      toast.success(
        `Recorded ${outcome.recorded} program${outcome.recorded === 1 ? "" : "s"}` +
          (outcome.updated ? ` and added to ${outcome.updated} existing` : "") +
          ` for ${prettyDate(date)}.`,
      );
      setRows(null);
    }
    router.refresh();
  };

  const includable = (rows ?? []).filter((r) => r.include && r.match && r.qty > 0).length;
  const unmatched = (rows ?? []).filter((r) => !r.match).length;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => fileRef.current?.click()}
        disabled={reading}
        title="Photograph the handwritten day sheet — AI drafts the runs for review"
      >
        {reading ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Camera className="h-3.5 w-3.5 mr-1.5" />
        )}
        {reading ? "Reading…" : "Read from photo"}
      </Button>

      {rows && (
        <Modal
          title={`Run sheet → ${prettyDate(date)} — review before recording`}
          onClose={() => (saving ? null : setRows(null))}
          size="xl"
        >
          <div className="p-4 space-y-3">
            {sheetDate && /^\d{4}-\d{2}-\d{2}$/.test(sheetDate) && sheetDate !== date && (
              <p className="flex items-start gap-1.5 text-xs text-[var(--warning)] bg-[var(--warning-bg)] rounded-md px-2.5 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                The sheet looks dated {prettyDate(sheetDate)}, but you&apos;re
                recording to {prettyDate(date)}. Change the page date first if
                that&apos;s wrong.
              </p>
            )}
            <p className="flex items-start gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              Nothing is saved yet. Ticked rows are recorded through the normal
              run flow (stock moves included). Unmatched rows need a program
              picked first; rows already logged today will{" "}
              <span className="font-semibold">add</span> to the existing count.
            </p>

            <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
              {rows.map((r, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={!r.match}
                    onChange={(e) => setRow(i, { include: e.target.checked })}
                    className="mt-1.5 h-4 w-4 cursor-pointer accent-[var(--primary)]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs italic text-[var(--muted-foreground)] shrink-0">
                        “{r.as_written}”
                      </span>
                      {r.confidence !== "high" && r.match && (
                        <Badge variant="warning" className="text-[10px]">
                          check match
                        </Badge>
                      )}
                      {r.existing && (
                        <Badge variant="warning" className="text-[10px]">
                          already logged ×{r.existing.runs_count} — will add
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1">
                      {r.match ? (
                        <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-[var(--primary)]/40 bg-[var(--primary)]/5 min-w-0 max-w-[520px]">
                          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
                          <span className="text-sm font-medium truncate flex-1">
                            {r.match.name}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--muted-foreground)] shrink-0">
                            {r.match.code}
                          </span>
                          {r.match.machining_time_seconds != null && (
                            <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(r.match.machining_time_seconds)}/run
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setRow(i, { match: null, include: false, existing: null })
                            }
                            title="Change program"
                            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="max-w-[520px]">
                          <ProgramSearch
                            onPick={(p: AuditedProgramHit) => pickProgram(i, p)}
                          />
                          {r.suggestions.length > 0 && (
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--muted-foreground)]">
                              <span>could be:</span>
                              {r.suggestions.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => pickProgram(i, s)}
                                  className="px-1.5 py-0.5 rounded border border-[var(--border)] font-mono hover:bg-[var(--muted)] cursor-pointer"
                                >
                                  {s.code ?? s.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 pt-1.5">
                    <span className="text-[11px] text-[var(--muted-foreground)]">×</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={r.qty || ""}
                      onChange={(e) =>
                        setRow(i, { qty: e.target.value ? Number(e.target.value) : 0 })
                      }
                      className="w-16 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                </div>
              ))}
            </div>

            {aiNotes && (
              <p className="text-[11px] text-[var(--muted-foreground)] italic">
                Reader notes: {aiNotes}
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-[var(--muted-foreground)]">
                {includable} of {rows.length} rows ticked
                {unmatched > 0 && ` · ${unmatched} unmatched`}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setRows(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={commit} disabled={saving || includable === 0}>
                  {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Record {includable} program{includable === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
