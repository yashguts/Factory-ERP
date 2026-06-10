"use client";

import { useEffect } from "react";
import {
  isStaleChunkError,
  reloadOnceForStaleChunks,
} from "@/components/layout/stale-deploy-guard";

/**
 * Last-resort error screen (replaces the root layout when even it crashed).
 * Styled inline because the app's CSS may not be loaded at this point.
 * Stale-chunk errors (post-redeploy) auto-heal with one reload.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    if (isStaleChunkError(error.message ?? "")) {
      reloadOnceForStaleChunks();
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fafaf9",
          color: "#1c1917",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: "#78716c", marginBottom: 16 }}>
            A new version of the app was probably released while this tab was
            open. Reloading fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
          {error.digest && (
            <p style={{ marginTop: 12, fontSize: 10, color: "#a8a29e" }}>
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
