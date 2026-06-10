"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import {
  isStaleChunkError,
  reloadOnceForStaleChunks,
} from "@/components/layout/stale-deploy-guard";

/**
 * Friendly per-page error screen (replaces Next's cryptic "Application
 * error: a client-side exception has occurred").
 *
 * Most of these in practice are stale-chunk errors: a redeploy removed the
 * JS files a long-open tab still references. Those self-heal with a single
 * reload, so we do it automatically (guarded against loops).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isStaleChunkError(error.message ?? "")) {
      reloadOnceForStaleChunks();
    }
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full card-surface p-6 text-center">
        <div className="mx-auto h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center mb-3">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
        </div>
        <h2 className="text-lg font-semibold mb-1">Something went wrong</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          This usually happens when a new version of the app was released
          while this tab was open. Reloading fixes it.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 cursor-pointer"
          >
            <RotateCw className="h-4 w-4" /> Reload page
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center px-3.5 h-9 rounded-md border border-[var(--border)] text-sm font-medium hover:bg-[var(--muted)] cursor-pointer"
          >
            Try again
          </button>
        </div>
        {error.digest && (
          <p className="mt-3 text-[10px] font-mono text-[var(--muted-foreground)]">
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
