"use client";

import { useMemo, useRef, useState, useEffect, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Briefcase, Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CabinScopeData } from "@/lib/actions/job-sets";

/**
 * Cabin-MRP job-scope picker. Default = ALL jobs in the demand-eligible set
 * (excludes Hold, fully-dispatched and Ready jobs). Or pick specific cabin
 * jobs and every Cabin-MRP view (requirements, programs-to-run optimiser,
 * weekly) recomputes server-side for exactly that set. A pick NARROWS the
 * eligible set, it never bypasses it (owner, 2026-07-16): the cabin ships in
 * the 2nd phase only, so a picked cabin job still counts ONLY if its linked
 * Job Order is In Production with Required = 2nd phase, not fully dispatched,
 * and the cabin job isn't marked Ready.
 *
 * Saved job sets (e.g. "Urgent", created in Make/Trade MRP over Job Orders)
 * appear as chips: picking one scopes the cabin plan to the cabin jobs whose
 * job number matches a member Job Order (?set=<id>, resolved server-side).
 * Sets are edited from Make/Trade MRP — here they're select-only; editing
 * the selection forks it into a plain ad-hoc pick (?jobs=id1,id2).
 */
export function CabinScopePicker({ scope }: { scope: CabinScopeData }) {
  const { options, sets, activeSet, selectedIds } = scope;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(selected);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Open the panel, seeding the draft from the resolved scope. Seeding ONLY on
  // the closed→open transition (not whenever `selected` changes) so an in-flight
  // navigation can't rewrite the draft underneath an open panel.
  const togglePanel = () => {
    if (!open) setDraft(new Set(selected));
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(sp.toString());
    mutate(params);
    // A different scope invalidates a programs-page "don't run" exclusion set.
    params.delete("exclude");
    const qs = params.toString();
    setOpen(false);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  const apply = (ids: Set<string>) =>
    navigate((params) => {
      if (ids.size > 0) params.set("jobs", [...ids].join(","));
      else params.delete("jobs");
      params.delete("set");
    });

  const applySetId = (id: string) =>
    navigate((params) => {
      params.set("set", id);
      params.delete("jobs");
    });

  const toggle = (id: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = options.filter((o) => {
    if (!tokens.length) return true;
    const hay = `${o.job_number} ${o.customer_name ?? ""}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });

  const selectedLabel = activeSet
    ? `${activeSet.name} · ${selected.size} cabin job${selected.size === 1 ? "" : "s"}`
    : selected.size > 0
      ? `${selected.size} job${selected.size === 1 ? "" : "s"} selected`
      : "All jobs";

  return (
    <div ref={boxRef} className="relative mb-4 -mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={togglePanel}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm font-medium cursor-pointer transition-colors",
            selected.size > 0 || activeSet
              ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
          )}
          title="Choose which cabin jobs this plan is computed for"
        >
          <Briefcase className="h-4 w-4" />
          Plan for: <strong>{selectedLabel}</strong>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* Saved job sets (defined over Job Orders in Make/Trade MRP). */}
        {sets.map((s) => {
          const active = activeSet?.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                if (!active) applySetId(s.id);
              }}
              className={cn(
                "inline-flex items-center gap-1 h-7 px-2 rounded-full border text-xs font-medium cursor-pointer transition-colors",
                active
                  ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
              )}
              title={`Plan for the cabin jobs of the "${s.name}" set (${s.member_count} job orders)`}
            >
              <Bookmark className="h-3 w-3" />
              {s.name} ({s.member_count})
            </button>
          );
        })}

        {selected.size > 0 || activeSet ? (
          <>
            <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[440px]">
              {activeSet
                ? `${activeSet.matched} of the set's job orders have a cabin job`
                : options.filter((o) => selected.has(o.id)).map((o) => o.job_number).join(", ")}
            </span>
            <button
              type="button"
              onClick={() => apply(new Set())}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--border)] text-xs cursor-pointer text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              title="Back to all jobs"
            >
              <X className="h-3 w-3" /> All jobs
            </button>
          </>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">
            All cabin jobs except Hold, fully dispatched and Ready. Pick specific jobs to plan just for them.
          </span>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-[440px] max-w-[92vw] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg">
          <div className="p-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search job # or customer…"
                className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">No cabin jobs match.</div>
            ) : (
              filtered.map((o) => {
                const on = draft.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer border-b border-[var(--border)]/60 last:border-0 hover:bg-[var(--muted)]"
                  >
                    <span
                      className={cn(
                        "inline-flex h-4 w-4 items-center justify-center rounded border shrink-0",
                        on ? "bg-[var(--primary)] border-[var(--primary)] text-white" : "border-[var(--border-strong,var(--border))]",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="font-mono font-medium shrink-0">{o.job_number}</span>
                    <span className="text-xs text-[var(--muted-foreground)] truncate flex-1">
                      {o.customer_name ?? ""}
                    </span>
                    <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums shrink-0">
                      {o.line_count} item{o.line_count === 1 ? "" : "s"}
                    </span>
                    {!o.eligible && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300"
                        title={
                          o.ready
                            ? "Marked Ready — its cabin items are already built; adds no demand even if picked"
                            : "Adds no demand even if picked (job on Hold / not in production / 2nd phase not required / fully dispatched) — the cabin ships in the 2nd phase only"
                        }
                      >
                        {o.ready ? "ready" : "no demand"}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center gap-2 p-2 border-t border-[var(--border)]">
            <span className="text-xs text-[var(--muted-foreground)] flex-1">
              {draft.size > 0 ? `${draft.size} selected` : "None selected = all jobs"}
              {activeSet ? " · applying forks off the set (edit sets in Make MRP)" : ""}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setDraft(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => apply(draft)}
              disabled={!!activeSet && draft.size === 0}
              title={
                activeSet && draft.size === 0
                  ? "Nothing selected — tick jobs to fork off the set, or use the All jobs button to leave it"
                  : undefined
              }
            >
              {activeSet ? "Apply without saving" : "Apply"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
