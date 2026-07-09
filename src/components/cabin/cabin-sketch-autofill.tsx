"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles, Loader2, Upload, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  autofillCabinFromSketch,
  type CabinAutofillData,
} from "@/lib/actions/cabin-autofill";

/** Read a File to a base64 string (no data: prefix) + its media type. */
function readAsBase64(file: File): Promise<{ b64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const res = String(reader.result || "");
      const comma = res.indexOf(",");
      resolve({ b64: comma >= 0 ? res.slice(comma + 1) : res, mediaType: file.type || "image/jpeg" });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * "Auto-fill from sketch" — upload a photo of a hand cabin sketch; Claude reads it,
 * resolves each panel to a real item, and pre-fills the form via onApply. The
 * engineer then reviews and saves through the normal path.
 */
export function CabinSketchAutofill({
  onApply,
  onFileSelected,
}: {
  onApply: (data: CabinAutofillData) => void;
  /** The raw sketch file the engineer picked — the parent keeps it to SAVE the
   *  sketch onto the cabin job (the AI only reads a base64 copy). Fires for any
   *  valid image, even if the AI read fails. */
  onFileSelected?: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CabinAutofillData | null>(null);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setSummary(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image (photo) of the sketch.");
      return;
    }
    // Hand the raw file to the parent so it can be SAVED with the job — do this
    // before the AI read so the sketch is kept even if the read fails.
    onFileSelected?.(file);
    let payload: { b64: string; mediaType: string };
    try {
      payload = await readAsBase64(file);
    } catch {
      setError("Could not read that image.");
      return;
    }
    startTransition(async () => {
      const res = await autofillCabinFromSketch(payload.b64, payload.mediaType);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSummary(res.data);
      onApply(res.data);
    });
  };

  return (
    <div className="card-surface p-3 mb-3">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = ""; // allow re-uploading the same file
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1.5 text-[var(--primary)]" />
          )}
          {isPending ? "Reading sketch…" : "Auto-fill from sketch"}
        </Button>
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
          <Upload className="h-3 w-3" /> Upload a photo of a hand cabin sketch — AI reads the panels &amp; fills the form for review.
        </span>
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 p-2 text-xs rounded-md bg-[var(--destructive-bg)] text-[var(--destructive)] border border-[var(--destructive-border)]">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="mt-2 text-xs rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="font-medium text-[var(--foreground)]">
              Filled {summary.rows.length} item{summary.rows.length === 1 ? "" : "s"}
            </span>
            {summary.job_order ? (
              <span className="text-[var(--muted-foreground)]">· Job {summary.job_order.job_number}</span>
            ) : summary.job_number_raw ? (
              <span className="text-[var(--warning,#b45309)]">· Job Order “{summary.job_number_raw}” not found — pick it above</span>
            ) : null}
            {(summary.door_type || summary.height || summary.opening) && (
              <span className="text-[var(--muted-foreground)]">
                · {[summary.door_type, summary.height, summary.opening].filter(Boolean).join(" / ")}
              </span>
            )}
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="ml-auto p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {summary.rows.some((r) => r.finish_to_fill) && (
            <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
              Finish left to fill on: {summary.rows.filter((r) => r.finish_to_fill).map((r) => r.item_name).join(", ")} — set it in the row.
            </div>
          )}

          {summary.unresolved.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1.5 font-medium text-[var(--warning,#b45309)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {summary.unresolved.length} item{summary.unresolved.length === 1 ? "" : "s"} couldn’t be matched — add manually:
              </div>
              <ul className="mt-1 space-y-0.5">
                {summary.unresolved.map((u, i) => (
                  <li key={i} className="text-[11px] text-[var(--muted-foreground)]">
                    <span className="font-mono">{u.cabin_type ?? "?"}</span>: “{u.raw}”
                    {u.finish ? ` · ${u.finish}` : ""} × {u.qty}
                    {u.candidates.length > 0 && (
                      <span className="text-[var(--muted-foreground)]/80">
                        {" "}— closest: {u.candidates.slice(0, 2).map((c) => c.name).join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            Review every line before saving — this is a first pass, not a final BOM.
          </div>
        </div>
      )}
    </div>
  );
}
