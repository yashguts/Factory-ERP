"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, FileText, ImageIcon, Trash2, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  recordGadDrawing,
  deleteGadDrawing,
} from "@/lib/actions/gad-drawings";
import { ensureDrawingRead } from "@/lib/actions/spec-vision";
import { resetPartListForNewDrawing } from "@/lib/actions/partlist";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useOperator } from "@/lib/jobs/use-operator";
import { validateGadFile, uploadGadFile } from "@/lib/jobs/gad-upload";

interface Props {
  jobId: string | null;
  /** Existing drawing on the job (server-rendered initial state). */
  initialUrl: string | null;
  initialFilename: string | null;
  initialUploadedAt: string | null;
  /**
   * Called when split view should be turned on after a fresh upload,
   * so the parent can flip its layout. Optional.
   */
  onAfterUpload?: () => void;
  /**
   * In create mode, the parent may not have saved the job yet. The
   * panel needs a way to materialize the jobId before uploading. The
   * returned id is then used for the upload call.
   */
  ensureJobId?: () => Promise<string | null>;
  /**
   * New Job form only: while there is no jobId yet, a picked file is NOT
   * uploaded — it is handed to the parent (null = cleared), which uploads it
   * as part of creating the job. A job is never created without its drawing.
   */
  onPendingFile?: (file: File | null) => void;
  /**
   * Optional close button (X) in the header. Set when the panel is
   * being shown as the right pane in split view.
   */
  onClose?: () => void;
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*";

/**
 * Right-pane component for viewing / uploading / replacing / removing
 * the General Arrangement Drawing attached to a job. PDFs render via
 * the browser's native viewer (iframe); images render as <img>.
 */
export function GadDrawingPanel({
  jobId,
  initialUrl,
  initialFilename,
  initialUploadedAt,
  onAfterUpload,
  ensureJobId,
  onPendingFile,
  onClose,
}: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [filename, setFilename] = useState<string | null>(initialFilename);
  const [uploadedAt, setUploadedAt] = useState<string | null>(
    initialUploadedAt,
  );
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ensureOperator } = useOperator();
  const router = useRouter();
  const toast = useToast();
  // File chosen for a job that doesn't exist yet (New Job form).
  const isPending = !jobId && !!url;

  const isPdf = !!filename && /\.pdf$/i.test(filename);

  const handlePickFile = () => inputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset for next picks of the same filename
    e.target.value = "";

    // New job not created yet: just hold the file. The form uploads it and
    // creates the job in one step (a job can't exist without its drawing).
    if (!jobId && onPendingFile) {
      const problem = validateGadFile(file);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      ensureOperator(); // capture WHO up front (prompts once per device)
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      setUrl(URL.createObjectURL(file));
      setFilename(file.name);
      setUploadedAt(null);
      onPendingFile(file);
      return;
    }

    // Replacing an existing drawing implies a spec change: warn that it clears
    // the cached read + the existing Part List (rebuilt fresh from the new drawing).
    const wasReplacing = !!url && !url.startsWith("blob:");
    if (wasReplacing && !confirm("Replacing the drawing will clear this job's existing Part List and re-read the new drawing. Continue?")) {
      return;
    }

    // Record WHO is uploading (prompts once per device if not yet set).
    const operator = ensureOperator();

    startTransition(async () => {
      setError(null);
      try {
        let id = jobId;
        if (!id && ensureJobId) {
          id = await ensureJobId();
        }
        if (!id) {
          setError(
            "Please fill the required Job Details first and save, then upload.",
          );
          return;
        }

        // Validate up front for friendly errors (the bucket enforces these too).
        const problem = validateGadFile(file);
        if (problem) {
          setError(problem);
          return;
        }

        // Upload the bytes straight from the browser to Supabase Storage
        // (see uploadGadFile). We then record only the path on the job.
        const uploaded = await uploadGadFile(id, file);
        if (!uploaded.ok) {
          setError(uploaded.error);
          return;
        }
        const path = uploaded.path;

        const result = await recordGadDrawing({
          jobId: id,
          path,
          filename: file.name,
          operator,
        });

        setUrl(result.url);
        setFilename(result.filename);
        setUploadedAt(result.uploaded_at);
        onAfterUpload?.();

        // A replacement means the spec likely changed — wipe the stale cached read
        // and the old Part List so both are rebuilt from the new drawing.
        if (wasReplacing) {
          await resetPartListForNewDrawing(id).catch(() => {});
        }

        // Auto-read the drawing in the background + cache it, so the Part List
        // can be generated instantly later (no inline vision at generate time).
        // Separate request (own timeout budget); runs to completion server-side.
        setReading(true);
        ensureDrawingRead(id)
          .catch(() => {})
          .finally(() => setReading(false));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  };

  const handleRemove = () => {
    // Not-yet-created job: just drop the chosen file.
    if (!jobId) {
      if (!onPendingFile) return;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      setUrl(null);
      setFilename(null);
      onPendingFile(null);
      return;
    }
    // A job may not run without its drawing: removing it puts the job on Hold,
    // and the remark is mandatory (logged in the job's status history).
    const remark = window.prompt(
      "Removing the GAD drawing will move this job to HOLD.\n\nEnter a remark (required) — why is the drawing being removed?",
    );
    if (remark === null) return; // cancelled
    if (!remark.trim()) {
      setError("Drawing not removed — a remark is required.");
      return;
    }
    const operator = ensureOperator();
    startTransition(async () => {
      setError(null);
      try {
        await deleteGadDrawing(jobId, remark.trim(), operator);
        setUrl(null);
        setFilename(null);
        setUploadedAt(null);
        toast.info("Drawing removed — job moved to Hold.");
        router.refresh(); // status badge / dropdown pick up the Hold
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] flex flex-col h-full overflow-hidden">
      {/* Hidden file picker — triggered programmatically */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {isPdf ? (
            <FileText className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
          ) : (
            <ImageIcon className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
              GAD Drawing
            </div>
            {filename && (
              <div
                className="text-[11px] text-[var(--muted-foreground)] truncate"
                title={filename}
              >
                {filename}
                {uploadedAt && (
                  <span className="opacity-70">
                    {" "}
                    · {new Date(uploadedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
            {isPending && (
              <div className="text-[11px] text-[var(--warning)]">
                Will be uploaded when you create the job
              </div>
            )}
            {reading && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--primary)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading drawing for Part List…
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={handlePickFile}
            disabled={busy}
            title={url ? "Replace drawing" : "Upload drawing"}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            {url ? "Replace" : "Upload"}
          </Button>
          {url && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              title="Remove drawing"
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Hide split view"
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-[var(--background)]">
        {error && (
          <div className="m-3 text-xs text-[var(--destructive)] bg-[var(--destructive-bg)] border border-[var(--destructive-border)] rounded px-2 py-1.5">
            {error}
          </div>
        )}

        {url ? (
          isPdf ? (
            <iframe
              key={url}
              src={url}
              className="w-full h-full min-h-[600px] bg-white"
              title={filename ?? "GAD drawing"}
            />
          ) : (
            // Image: fit width, allow vertical scroll within the body
            <img
              key={url}
              src={url}
              alt={filename ?? "GAD drawing"}
              className="block max-w-full mx-auto"
            />
          )
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<Upload className="h-10 w-10" />}
              title="No GAD drawing yet"
              description={
                !jobId && onPendingFile
                  ? "A GAD drawing is REQUIRED to create a job. Choose a PDF or image (PNG / JPG / WebP, max 50 MB) — the job cannot be created without it."
                  : "Upload a PDF or image (PNG / JPG / WebP, max 50 MB) so you can cross-check items against the drawing side-by-side."
              }
              action={
                <Button size="sm" onClick={handlePickFile} disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Upload Drawing
                </Button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
