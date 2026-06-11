"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PlayCircle,
  Search,
  Loader2,
  X,
  Plus,
  Clock,
  Check,
  Trash2,
  Info,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/utils";
import {
  searchAuditedPrograms,
  recordRun,
  updateRunCount,
  updateRunDate,
  deleteRun,
  type AuditedProgramHit,
  type DailyRunRow,
} from "@/lib/actions/operation-runs";

const MACHINE: Record<string, string> = {
  cnc_punch: "Punch",
  cnc_laser: "Laser",
  cnc_cutting: "Cutting",
  assembly_fit: "Assembly",
};

interface Props {
  date: string;
  maxDate: string;
  initialRows: DailyRunRow[];
}

export function DailyRunsClient({ date, maxDate, initialRows }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  // ---- add-run form state ----
  const [picked, setPicked] = useState<AuditedProgramHit | null>(null);
  const [count, setCount] = useState<number>(1);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const changeDate = (d: string) => {
    if (!d) return;
    startTransition(() => router.push(`/program-runs?date=${d}`));
  };

  const record = () => {
    if (!picked) return;
    setSaving(true);
    startTransition(async () => {
      const res = await recordRun({
        operation_id: picked.id,
        run_date: date,
        runs_count: count,
        note,
      });
      setSaving(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Recorded — ${picked.code ?? picked.name} ×${count} on ${prettyDate(date)}.`,
      );
      setPicked(null);
      setCount(1);
      setNote("");
      router.refresh();
    });
  };

  const totalRuns = initialRows.reduce((s, r) => s + r.runs_count, 0);
  const knownTime = initialRows.filter((r) => r.machining_time_seconds != null);
  const totalSeconds = knownTime.reduce(
    (s, r) => s + r.runs_count * (r.machining_time_seconds ?? 0),
    0,
  );
  const missingTime = initialRows.length - knownTime.length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PlayCircle className="h-6 w-6 text-[var(--muted-foreground)]" />
            Daily Program Runs
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            The factory logbook — which programs actually ran, day by day
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Date</label>
          <Input
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => changeDate(e.target.value)}
            className="w-[170px] cursor-pointer"
          />
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
      </div>

      {/* Add a run */}
      <div className="card-surface p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">
          Record a run for {prettyDate(date)}
        </h2>
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            {picked ? (
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-blue-300 bg-blue-50/40 min-w-0">
                <span className="text-sm font-medium truncate flex-1">
                  {picked.name}
                </span>
                <span className="text-[11px] font-mono text-[var(--muted-foreground)] shrink-0">
                  {picked.code}
                </span>
                {picked.machining_time_seconds != null && (
                  <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(picked.machining_time_seconds)}/run
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  title="Change program"
                  className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <ProgramSearch onPick={setPicked} />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[var(--muted-foreground)]">Runs</label>
            <input
              type="number"
              min={1}
              step={1}
              value={count || ""}
              onChange={(e) => setCount(e.target.value ? Number(e.target.value) : 0)}
              className="w-20 h-9 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — operator, shift, remarks…"
            className="flex-1 min-w-[200px]"
          />
          <Button onClick={record} disabled={!picked || count <= 0 || saving}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1.5" />
            )}
            Record
          </Button>
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-[var(--muted-foreground)] mt-3">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
          Only <span className="font-semibold">audited</span> programs can be
          logged. If the factory ran something new, create the program and mark
          it audited first — then record it here. Logging a run does{" "}
          <span className="font-semibold">not</span> consume or produce stock.
        </p>
      </div>

      {/* Day summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <SummaryCard label="Programs run" value={String(initialRows.length)} />
        <SummaryCard label="Total runs" value={totalRuns.toLocaleString()} />
        <SummaryCard
          label="Machine time"
          value={totalSeconds > 0 ? formatDuration(totalSeconds) : "—"}
          sub={missingTime > 0 ? `${missingTime} program${missingTime === 1 ? "" : "s"} missing time/run` : undefined}
        />
      </div>

      {/* The day's log */}
      {initialRows.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-[var(--muted-foreground)]">
          Nothing recorded for {prettyDate(date)} yet.
        </div>
      ) : (
        <div className="card-surface divide-y divide-[var(--border)]">
          {initialRows.map((r) => (
            <RunRow key={r.id} row={r} onChanged={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RunRow({ row, onChanged }: { row: DailyRunRow; onChanged: () => void }) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [count, setCount] = useState<number>(row.runs_count);
  const [busy, setBusy] = useState(false);
  const dirty = count !== row.runs_count && count > 0;

  // Pre-filled per-entry date: shows exactly which day this entry belongs to,
  // and changing it MOVES the entry to that day (it leaves the current list).
  const changeDate = (newDate: string) => {
    if (!newDate || newDate === row.run_date) return;
    if (
      !window.confirm(
        `Move "${row.name}" from ${prettyDate(row.run_date)} to ${prettyDate(newDate)}?`,
      )
    )
      return;
    setBusy(true);
    startTransition(async () => {
      const res = await updateRunDate(row.id, newDate);
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${row.code ?? row.name} moved to ${prettyDate(newDate)}.`);
      onChanged();
    });
  };

  const saveCount = () => {
    setBusy(true);
    startTransition(async () => {
      const res = await updateRunCount(row.id, count);
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error);
        setCount(row.runs_count);
        return;
      }
      toast.success(`${row.code ?? row.name} — count updated to ×${count}.`);
      onChanged();
    });
  };

  const remove = () => {
    if (!window.confirm(`Remove the run entry for "${row.name}"?`)) return;
    setBusy(true);
    startTransition(async () => {
      const res = await deleteRun(row.id);
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error ?? "Could not remove the entry.");
        return;
      }
      toast.success("Run entry removed.");
      onChanged();
    });
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
      <Badge variant="neutral" className="font-mono text-[11px] shrink-0">
        {MACHINE[row.machine] ?? row.machine}
      </Badge>
      <span className="font-mono text-xs text-[var(--muted-foreground)] shrink-0 w-44 truncate" title={row.code ?? undefined}>
        {row.code}
      </span>
      <span className="text-sm font-medium flex-1 min-w-[160px] truncate" title={row.name}>
        {row.name}
      </span>
      {row.note && (
        <span className="text-xs text-[var(--muted-foreground)] italic truncate max-w-[25%]" title={row.note}>
          {row.note}
        </span>
      )}
      <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 tabular-nums inline-flex items-center gap-1 w-24 justify-end">
        <Clock className="h-3 w-3" />
        {row.machining_time_seconds != null
          ? formatDuration(row.runs_count * row.machining_time_seconds)
          : "—"}
      </span>
      <input
        type="date"
        value={row.run_date}
        onChange={(e) => changeDate(e.target.value)}
        disabled={busy}
        title="The day this entry belongs to — change it to move the entry to another date"
        className="h-8 px-2 text-xs rounded-md border border-[var(--border)] bg-[var(--background)] cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[11px] text-[var(--muted-foreground)]">×</span>
        <input
          type="number"
          min={1}
          step={1}
          value={count || ""}
          onChange={(e) => setCount(e.target.value ? Number(e.target.value) : 0)}
          className="w-16 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
        {dirty && (
          <button
            type="button"
            onClick={saveCount}
            disabled={busy}
            title="Save the new count"
            className="p-1 rounded text-emerald-700 hover:bg-emerald-50 cursor-pointer"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        title="Remove this entry"
        className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProgramSearch({ onPick }: { onPick: (p: AuditedProgramHit) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AuditedProgramHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const data = await searchAuditedPrograms(q, 20);
        if (seqRef.current === seq) setResults(data);
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 250);
  }, []);

  useEffect(() => {
    if (open) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, doSearch]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search audited programs by name or code…"
        className="w-full h-9 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      {loading && (
        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
      )}
      {open && search.trim() && (
        <div className="absolute z-50 mt-1 w-full min-w-[380px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
              {loading ? (
                "Searching…"
              ) : (
                <span>
                  No <strong>audited</strong> program matches. If the factory ran
                  a new program, create it and mark it audited first.{" "}
                  <Link
                    href="/programs"
                    className="text-[var(--primary)] hover:underline inline-flex items-center gap-0.5"
                  >
                    Open Programs <ExternalLink className="h-3 w-3" />
                  </Link>
                </span>
              )}
            </div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onPick(p);
                  setSearch("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
              >
                <div className="font-medium leading-snug break-words">{p.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                  <span className="font-mono">{p.code}</span>
                  <span>{MACHINE[p.machine] ?? p.machine}</span>
                  {p.machining_time_seconds != null && (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {formatDuration(p.machining_time_seconds)}/run
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && (
        <div className="text-[10px] text-amber-600 mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
