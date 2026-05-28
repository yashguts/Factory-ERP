"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Catches the Next.js "Server Action X was not found on the server"
 * error globally and prompts the user to hard-reload.
 *
 * This happens whenever Netlify (or any host) redeploys while the user
 * has a page open: the action-id hashes change in the new build, so
 * the stale client calls a hash the server doesn't know about. Without
 * this guard, each individual server-action call surfaces the cryptic
 * error in its own way (an alert, a swallowed error, etc.), and the
 * user has no idea their page is the problem.
 *
 * We listen at the window level (unhandledrejection + error) because
 * server actions throw rejected promises from event handlers — React
 * error boundaries don't catch those.
 */
export function StaleDeployGuard() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const matches = (val: unknown): boolean => {
      const msg =
        typeof val === "string"
          ? val
          : val instanceof Error
            ? val.message
            : "";
      return /Server Action[^\n]*was not found on the server/i.test(msg);
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      if (matches(e.reason)) {
        setStale(true);
      }
    };
    const onError = (e: ErrorEvent) => {
      if (matches(e.message) || matches(e.error)) {
        setStale(true);
      }
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[100] max-w-md rounded-lg border border-amber-300 bg-amber-50 shadow-lg"
    >
      <div className="flex items-start gap-2 p-3">
        <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
        <div className="flex-1 text-xs text-amber-900">
          <div className="font-semibold mb-0.5">New version deployed</div>
          <div className="opacity-90">
            This page was loaded before the latest release, so some
            actions won&apos;t work until you reload.
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 inline-flex items-center px-2.5 py-1 rounded-md bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 cursor-pointer"
          >
            Reload page
          </button>
        </div>
        <button
          type="button"
          onClick={() => setStale(false)}
          title="Dismiss"
          className="p-1 rounded text-amber-800 hover:bg-amber-100 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
