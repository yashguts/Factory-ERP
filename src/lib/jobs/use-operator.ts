"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "factory.operator";

/** Read the chosen operator name (client-only). Empty/whitespace -> null. */
export function readOperator(): string | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  return v && v.trim() ? v.trim() : null;
}

/**
 * Mirror the chosen name into a cookie so SERVER actions can stamp it on the
 * audit trail (e.g. inventory movements) without threading the operator through
 * every call. JS-set + readable (not httpOnly) — an audit name, not security.
 */
function syncOperatorCookie(name: string | null): void {
  if (typeof document === "undefined") return;
  document.cookie = name
    ? `${KEY}=${encodeURIComponent(name)}; path=/; max-age=31536000; samesite=lax`
    : `${KEY}=; path=/; max-age=0; samesite=lax`;
}

function writeOperator(name: string | null): void {
  if (typeof window === "undefined") return;
  const v = name && name.trim() ? name.trim() : null;
  if (v) window.localStorage.setItem(KEY, v);
  else window.localStorage.removeItem(KEY);
  syncOperatorCookie(v);
}

/**
 * Lightweight "who am I" operator identity.
 *
 * This app has no auth (shared anon key), so for the audit trail the user wants
 * — who created a job, uploaded a GAD, marked it audited — each device simply
 * remembers a chosen name in localStorage and we attach it to those actions.
 * It is NOT security (anyone can type any name); it just puts a name on the
 * record, and degrades cleanly to null -> 'unknown' server-side.
 */
export function useOperator(): {
  operator: string | null;
  setOperator: (name: string | null) => void;
  /** Ensure an operator is set, prompting once if needed. Returns the name (or null if dismissed). */
  ensureOperator: () => string | null;
} {
  const [operator, setOp] = useState<string | null>(null);

  useEffect(() => {
    const current = readOperator();
    setOp(current);
    // Backfill the cookie for users who already chose a name before this existed,
    // so server-side stamping works without them re-entering it.
    syncOperatorCookie(current);
  }, []);

  const setOperator = useCallback((name: string | null) => {
    writeOperator(name);
    setOp(readOperator());
  }, []);

  const ensureOperator = useCallback((): string | null => {
    const current = readOperator();
    if (current) return current;
    if (typeof window === "undefined") return null;
    const typed = window.prompt(
      "Your name (recorded against this action, e.g. who uploaded / audited):",
      "",
    );
    const v = typed && typed.trim() ? typed.trim() : null;
    if (v) {
      writeOperator(v);
      setOp(v);
    }
    return v;
  }, []);

  return { operator, setOperator, ensureOperator };
}
