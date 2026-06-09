"use client";

import { useEffect, useRef } from "react";

/**
 * URL-backed list state helpers.
 *
 * Every list page keeps its search/filter/sort/page state in component
 * useState — which means pressing Back after opening a row used to reset
 * the whole view. These helpers mirror that state into the URL query
 * string (via shallow history.replaceState — NO router round trip, no
 * history spam), so the history entry the user returns to carries their
 * filters, and the component re-initialises from it on mount.
 *
 * Usage:
 *   const sp = useSearchParams();
 *   const [type, setType] = useState(() => readParam(sp, "type", "all", TYPES));
 *   const [page, setPage] = useState(() => readIntParam(sp, "page", 1));
 *   useUrlListSync({ type, page }, { type: "all", page: 1 });
 */

/** Read a string param with a fallback; optionally validate against a whitelist. */
export function readParam(
  sp: URLSearchParams | { get(key: string): string | null },
  key: string,
  fallback: string,
  allowed?: readonly string[],
): string {
  const v = sp.get(key);
  if (v == null || v === "") return fallback;
  if (allowed && !allowed.includes(v)) return fallback;
  return v;
}

/** Read a positive-integer param (e.g. page number) with a fallback. */
export function readIntParam(
  sp: URLSearchParams | { get(key: string): string | null },
  key: string,
  fallback: number,
): number {
  const v = sp.get(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** True when none of the given keys are present in the params (list opened fresh). */
export function hasNoListParams(
  sp: URLSearchParams | { get(key: string): string | null },
  keys: readonly string[],
): boolean {
  return keys.every((k) => sp.get(k) == null);
}

/**
 * Mirror list state into the URL. Default-valued keys are stripped so URLs
 * stay clean; params this list doesn't own (e.g. ?date, ?edit) are preserved.
 */
export function useUrlListSync(
  state: Record<string, string | number>,
  defaults: Record<string, string | number>,
): void {
  // Serialise to keep the effect dependency simple and value-based.
  const serialized = JSON.stringify(state);
  const defaultsRef = useRef(defaults);

  useEffect(() => {
    const current: Record<string, string | number> = JSON.parse(serialized);
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(current)) {
      const def = defaultsRef.current[key];
      if (value === def || value === "" || value == null) params.delete(key);
      else params.set(key, String(value));
    }
    const qs = params.toString();
    const next = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      // Keep Next.js' own history state object intact (it stores scroll/router info).
      window.history.replaceState(window.history.state, "", next);
    }
  }, [serialized]);
}
