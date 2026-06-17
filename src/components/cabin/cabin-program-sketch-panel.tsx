"use client";

import { useRef, useState, useTransition } from "react";
import {
  Upload,
  FileText,
  ImageIcon,
  Trash2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  uploadCabinProgramSketch,
  deleteCabinProgramSketch,
} from "@/lib/actions/cabin-programs";

interface Props {
  programId: string;
  initialUrl: string | null;
  initialFilename: string | null;
  initialUploadedAt: string | null;
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*";

/**
 * View / upload / replace / remove the nesting-report PDF (or image) attached to
 * a cabin program — the document the machining time and scrap are read off.
 * Mirrors ProgramSketchPanel (regular programs). PDFs render in the native
 * viewer; images via <img>.
 */
export function CabinProgramSketchPanel({
  programId,
  initialUrl,
  initialFilename,
  initialUploadedAt,
}: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [filename, setFilename] = useState<string | null>(initialFilename);
  const [uploadedAt, setUploadedAt] = useState<string | null>(initialUploadedAt);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPdf = !!filename && /\.pdf$/i.test(filename);
  const handlePickFile = () => inputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    startTransition(async () => {
      setError(null);
      try {
        const fd = new FormData();
        fd.append("programId", programId);
        fd.append("file", file);
        const result = await uploadCabinProgramSketch(fd);
        setUrl(result.url);
        setFilename(result.filename);
        setUploadedAt(result.uploaded_at);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  };

  const handleRemove = () => {
    if (!confirm("Remove the PDF from this cabin program?")) return;
    startTransition(async () => {
      setError(null);
      try {
        await deleteCabinProgramSketch(programId);
        setUrl(null);
        setFilename(null);
        setUploadedAt(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] flex flex-col overflow-hidden">
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
            <div className="text-sm font-semibold uppercase tracking-wide">
              Nesting report
            </div>
            {filename && (
              <div
                className="text-[11px] text-[var(--muted-foreground)] truncate"
                title={filename}
              >
                {filename}
                {uploadedAt && (
                  <span className="opacity-70"> · {new Date(uploadedAt).toLocaleString()}</span>
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
            title={url ? "Replace PDF" : "Upload PDF"}
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
              title="Remove PDF"
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-[var(--background)] min-h-[300px]">
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
              className="w-full h-full min-h-[500px] bg-white"
              title={filename ?? "Cabin program nesting report"}
            />
          ) : (
            // Arbitrary user-uploaded image of unknown dimensions — a plain
            // <img> is the right tool here (same as the program sketch viewer).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={filename ?? "Cabin program nesting report"}
              className="block max-w-full mx-auto"
            />
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <Upload className="h-10 w-10 text-[var(--muted-foreground)] mb-3" />
            <p className="text-sm font-medium">No PDF yet</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-xs">
              Upload the nesting-report PDF or image (PNG / JPG / WebP, max 50 MB),
              then enter the machining time and scrap from it on the program.
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
              Upload PDF
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
