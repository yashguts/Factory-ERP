"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, FileText, ImageIcon, Trash2, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordGadDrawing, deleteGadDrawing } from "@/lib/actions/gad-drawings";
import { uploadFileToBucket } from "@/lib/storage/upload";

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
  onClose,
}: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [filename, setFilename] = useState<string | null>(initialFilename);
  const [uploadedAt, setUploadedAt] = useState<string | null>(
    initialUploadedAt,
  );
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPdf = !!filename && /\.pdf$/i.test(filename);

  const handlePickFile = () => inputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset for next picks of the same filename
    e.target.value = "";

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

        const { path } = await uploadFileToBucket("gad-drawings", id, file);
        const result = await recordGadDrawing(id, path, file.name);

        setUrl(result.url);
        setFilename(result.filename);
        setUploadedAt(result.uploaded_at);
        onAfterUpload?.();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  };

  const handleRemove = () => {
    if (!jobId) return;
    if (!confirm("Remove the GAD drawing from this job?")) return;
    startTransition(async () => {
      setError(null);
      try {
        await deleteGadDrawing(jobId);
        setUrl(null);
        setFilename(null);
        setUploadedAt(null);
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
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
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
          <div className="m-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
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
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <Upload className="h-10 w-10 text-[var(--muted-foreground)] mb-3" />
            <p className="text-sm text-[var(--foreground)] font-medium">
              No GAD drawing yet
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-xs">
              Upload a PDF or image (PNG / JPG / WebP, max 50 MB) so you can
              cross-check items against the drawing side-by-side.
            </p>
            <Button
              size="sm"
              onClick={handlePickFile}
              disabled={busy}
              className="mt-4"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              Upload Drawing
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
