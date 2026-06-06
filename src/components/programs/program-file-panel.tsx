"use client";

import { useRef, useState, useTransition } from "react";
import {
  Upload,
  FileText,
  ImageIcon,
  File as FileIcon,
  Trash2,
  ExternalLink,
  Download,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  uploadProgramFile,
  deleteProgramFile,
  type ProgramFileSlot,
} from "@/lib/actions/operations";

interface Props {
  operationId: string;
  slot: ProgramFileSlot;
  /** Display label, e.g. "Design File" / "Print File". */
  title: string;
  initialUrl: string | null;
  initialFilename: string | null;
  initialUploadedAt: string | null;
}

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — must match the server action.

/**
 * View / upload / replace / remove one of a program's extra attachment slots
 * (design or print). Any file format, ≤15 MB. Mirrors ProgramSketchPanel but
 * is format-agnostic: PDFs/images preview inline, anything else shows a
 * download card.
 */
export function ProgramFilePanel({
  operationId,
  slot,
  title,
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
  const isImage = !!filename && /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(filename);

  const handlePickFile = () => inputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size === 0) {
      setError("File is empty.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 15 MB.`,
      );
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const fd = new FormData();
        fd.append("operationId", operationId);
        fd.append("slot", slot);
        fd.append("file", file);
        const result = await uploadProgramFile(fd);
        setUrl(result.url);
        setFilename(result.filename);
        setUploadedAt(result.uploaded_at);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  };

  const handleRemove = () => {
    if (!confirm(`Remove the ${title.toLowerCase()} from this program?`)) return;
    startTransition(async () => {
      setError(null);
      try {
        await deleteProgramFile(operationId, slot);
        setUrl(null);
        setFilename(null);
        setUploadedAt(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  const HeaderIcon = isPdf ? FileText : isImage ? ImageIcon : FileIcon;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] flex flex-col overflow-hidden">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <HeaderIcon className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold uppercase tracking-wide">
              {title}
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
            title={url ? `Replace ${title.toLowerCase()}` : `Upload ${title.toLowerCase()}`}
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
              title={`Remove ${title.toLowerCase()}`}
              className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="bg-[var(--background)]">
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
              className="w-full min-h-[320px] bg-white"
              title={filename ?? title}
            />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={filename ?? title}
              className="block max-w-full mx-auto"
            />
          ) : (
            // Arbitrary format — offer a download rather than an inline viewer.
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon className="h-5 w-5 text-[var(--muted-foreground)] shrink-0" />
                <span className="text-sm truncate" title={filename ?? ""}>
                  {filename}
                </span>
              </div>
              <a href={url} download target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="secondary">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download
                </Button>
              </a>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-6">
            <Upload className="h-8 w-8 text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm font-medium">No {title.toLowerCase()} yet</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-xs">
              Upload any file (max 15 MB).
            </p>
            <Button
              size="sm"
              onClick={handlePickFile}
              disabled={busy}
              className="mt-3"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              Upload {title}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
