"use client";

import { useMemo, useRef, useState, useEffect, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Briefcase, Check, ChevronDown, Loader2, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  saveJobSet,
  updateJobSetMembers,
  deleteJobSet,
  type JobScopeData,
} from "@/lib/actions/job-sets";

/**
 * Make/Trade MRP job-scope picker — the Job-Orders twin of the Cabin MRP
 * picker. Default = ALL in-production jobs with a Required stage (the normal
 * MRP demand set). Or pick specific Job Orders and every Make/Trade view
 * (requirements, programs-to-run optimiser, buy list, weekly) recomputes
 * server-side for exactly that set. A pick NARROWS the demand set, it never
 * bypasses the demand rules (owner, 2026-07-16): a picked job still counts
 * only if it's In Production, and only for its Required stage's items. Only
 * the date cutoff is ignored for a picked set (the owner chose the jobs).
 *
 * A selection can be SAVED as a named set (e.g. "Urgent") — one chip-click
 * on every MRP surface, Cabin MRP included (there it resolves to the cabin
 * jobs matching the set's job numbers). A set scope lives in the URL as
 * ?set=<id> (resolved server-side, so the view always reflects the set's
 * current members); an unsaved pick stays ?jobs=id1,id2. The MrpToolbar
 * carries both across the views.
 */
export function JobScopePicker({ scope }: { scope: JobScopeData }) {
  const { options, sets, activeSet, selectedIds } = scope;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(selected);
  const [search, setSearch] = useState("");
  const [setName, setSetName] = useState("");
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

  /** Apply an ad-hoc (unsaved) selection: ?jobs=, clearing any set scope. */
  const apply = (ids: Set<string>) =>
    navigate((params) => {
      if (ids.size > 0) params.set("jobs", [...ids].join(","));
      else params.delete("jobs");
      params.delete("set");
    });

  /** Scope to a saved set: ?set=, clearing any ad-hoc selection. */
  const applySetId = (id: string) =>
    navigate((params) => {
      params.set("set", id);
      params.delete("jobs");
    });

  const saveAsSet = () => {
    const ids = [...draft];
    startSaving(async () => {
      const res = await saveJobSet(setName, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.updated
          ? `Set "${setName.trim()}" updated — ${ids.length} jobs`
          : `Set "${setName.trim()}" saved — ${ids.length} jobs`,
      );
      setSetName("");
      applySetId(res.id);
    });
  };

  const updateActiveSet = () => {
    if (!activeSet) return;
    const ids = [...draft];
    startSaving(async () => {
      const res = await updateJobSetMembers(activeSet.id, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Set "${activeSet.name}" updated — ${ids.length} jobs`);
      setOpen(false);
      // New members = a new scope: stale "don't run" exclusions must go, same
      // as every other scope change. navigate() drops ?exclude= and keeps
      // ?set=; with no exclusions a plain refresh re-resolves the members.
      if (sp.get("exclude")) navigate(() => {});
      else startTransition(() => router.refresh());
    });
  };

  const removeActiveSet = () => {
    if (!activeSet) return;
    if (!window.confirm(`Delete the set "${activeSet.name}"? The jobs themselves are not affected.`))
      return;
    startSaving(async () => {
      const res = await deleteJobSet(activeSet.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Set "${activeSet.name}" deleted`);
      navigate((params) => {
        params.delete("set");
        params.delete("jobs");
      });
    });
  };

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
    ? `${activeSet.name} · ${selected.size} job${selected.size === 1 ? "" : "s"}`
    : selected.size > 0
      ? `${selected.size} job${selected.size === 1 ? "" : "s"} selected`
      : "All jobs";

  // The draft differs from what's applied — drives the Update button emphasis.
  const draftDirty =
    draft.size !== selected.size || [...draft].some((id) => !selected.has(id));

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
          title="Choose which Job Orders this plan is computed for"
        >
          <Briefcase className="h-4 w-4" />
          Plan for: <strong>{selectedLabel}</strong>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* Saved sets — one click to scope any MRP view to the set. */}
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
              title={`Plan for the "${s.name}" set (${s.member_count} jobs)`}
            >
              <Bookmark className="h-3 w-3" />
              {s.name} ({s.member_count})
            </button>
          );
        })}

        {selected.size > 0 || activeSet ? (
          <>
            {!activeSet && (
              <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[440px]">
                {options.filter((o) => selected.has(o.id)).map((o) => o.job_number).join(", ")}
              </span>
            )}
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
            All in-production jobs with a Required stage. Pick specific jobs to plan just for them.
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
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">No jobs match.</div>
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
                        title="Adds no demand even if picked — the job is not In Production, or its Required is still New. Update the job's status/Required to count it."
                      >
                        no demand
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
          {/* Save the current selection as a named set / manage the active set. */}
          <div className="flex items-center gap-2 p-2 border-t border-[var(--border)] bg-[var(--muted)]/30 rounded-b-md">
            {activeSet ? (
              <>
                <button
                  type="button"
                  onClick={removeActiveSet}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--border)] text-xs cursor-pointer text-red-600 hover:bg-red-50 disabled:opacity-50"
                  title={`Delete the "${activeSet.name}" set (jobs are not affected)`}
                >
                  <Trash2 className="h-3 w-3" /> Delete set
                </button>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant={draftDirty ? "primary" : "secondary"}
                  onClick={updateActiveSet}
                  disabled={isSaving || draft.size === 0}
                >
                  {isSaving ? "Saving…" : `Update ${activeSet.name}`}
                </Button>
              </>
            ) : (
              <>
                <Bookmark className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                <input
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  placeholder='Save selection as… (e.g. "Urgent")'
                  className="flex-1 h-7 px-2 text-xs rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={saveAsSet}
                  disabled={isSaving || draft.size === 0 || !setName.trim()}
                >
                  {isSaving ? "Saving…" : "Save as set"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
