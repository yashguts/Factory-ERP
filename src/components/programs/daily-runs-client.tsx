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
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, SectionHeader } from "@/components/ui/card";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RunSheetReader } from "@/components/programs/run-sheet-reader";
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
      try {
        const res = await recordRun({
          operation_id: picked.id,
          run_date: date,
          runs_count: count,
          note,
        });
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
      } catch {
        // A rejected action (redeploy/network) must not leave the button dead.
        toast.error("Couldn't record — connection problem. Check the list and retry.");
      } finally {
        setSaving(false);
      }
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
      <PageHeader
        title="Daily Program Runs"
        icon={<PlayCircle size={18} />}
        subtitle="The factory logbook — which programs actually ran, day by day"
        actions={
          <>
            <label className="text-sm font-medium">Date</label>
            <Input
              type="date"
              size="sm"
              value={date}
              max={maxDate}
              onChange={(e) => changeDate(e.target.value)}
              className="w-[170px] cursor-pointer"
            />
            {isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
            )}
          </>
        }
      />

      {/* Add a run */}
      <Card className="mb-4">
        <SectionHeader
          title={`Record a run for ${prettyDate(date)}`}
          actions={<RunSheetReader date={date} />}
        />
        <CardBody className="space-y-2">
          <div className="flex items-start gap-2 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              {picked ? (
                <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-[var(--primary)]/40 bg-[var(--primary)]/5 min-w-0">
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
                className="w-20 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <Input
              size="sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional) — operator, shift, remarks…"
              className="flex-1 min-w-[200px]"
            />
            <Button size="sm" onClick={record} disabled={!picked || count <= 0 || saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1.5" />
              )}
              Record
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-[var(--muted-foreground)]">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            Only <span className="font-semibold">audited</span> programs can be
            logged. If the factory ran something new, create the program and mark
            it audited first — then record it here. Recording a run{" "}
            <span className="font-semibold">consumes its input sheets and adds
            its produced parts to stock</span> (runs dated before the inventory
            cutover don&apos;t post stock).
          </p>
        </CardBody>
      </Card>

      {/* Day summary */}
      <StatStrip className="mb-4">
        <StatTile label="Programs run" value={String(initialRows.length)} />
        <StatTile label="Total runs" value={totalRuns.toLocaleString()} />
        <StatTile
          label="Machine time"
          value={totalSeconds > 0 ? formatDuration(totalSeconds) : "—"}
          tone={missingTime > 0 ? "warn" : "default"}
          sub={missingTime > 0 ? `${missingTime} program${missingTime === 1 ? "" : "s"} missing time/run` : undefined}
        />
      </StatStrip>

      {/* The day's log */}
      {initialRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PlayCircle size={28} />}
            title={`Nothing recorded for ${prettyDate(date)} yet.`}
          />
        </Card>
      ) : (
        <Card>
          <Table density="compact">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialRows.map((r) => (
                <RunRow key={r.id} row={r} onChanged={() => router.refresh()} />
              ))}
            </TableBody>
          </Table>
        </Card>
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
  // Outputs preview multiplies by the live count (so editing runs updates the
  // projected qty added to stock); fall back to the saved count while blank.
  const effCount = count > 0 ? count : row.runs_count;

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
    <TableRow>
      <TableCell>
        <Badge variant="neutral" className="font-mono text-[11px]">
          {MACHINE[row.machine] ?? row.machine}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs text-[var(--muted-foreground)] max-w-[200px] align-top" title={row.code ?? undefined}>
        <div className="truncate">{row.code}</div>
        {row.inputs.length > 0 && (
          <div className="mt-0.5 font-sans text-[10px] leading-tight font-normal text-[var(--muted-foreground)] whitespace-normal">
            <span className="text-[var(--muted-foreground)]/70">uses → </span>
            {row.inputs.map((inp, i) => (
              <span key={i} title={inp.code ?? undefined}>
                {i > 0 && " · "}
                {inp.name}{" "}
                <span className="tabular-nums font-medium text-[var(--foreground)]/70">
                  ×{fmtQty(inp.perRun * effCount)}
                </span>
              </span>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm font-medium max-w-[340px] align-top">
        <div className="truncate" title={row.name}>{row.name}</div>
        {row.outputs.length > 0 ? (
          <div className="mt-0.5 text-[10px] leading-tight font-normal text-[var(--muted-foreground)] whitespace-normal">
            <span className="text-[var(--muted-foreground)]/70">cuts → </span>
            {row.outputs.map((o, i) => (
              <span key={i} title={o.code ?? undefined}>
                {i > 0 && " · "}
                {o.name}{" "}
                <span
                  className={`tabular-nums ${
                    o.role === "component"
                      ? "font-medium text-[var(--foreground)]/70"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  ×{fmtQty(o.perRun * effCount)}
                </span>
                {o.role !== "component" && (
                  <span className="ml-0.5 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/55">
                    {o.role === "cut_part" ? "loose" : "tool"}
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-0.5 text-[10px] leading-tight font-normal text-[var(--muted-foreground)]/60 italic">
            no outputs recorded
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-[var(--muted-foreground)] italic max-w-[200px] truncate" title={row.note ?? undefined}>
        {row.note}
      </TableCell>
      <TableCell className="text-[11px] text-[var(--muted-foreground)] tabular-nums text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {row.machining_time_seconds != null
            ? formatDuration(row.runs_count * row.machining_time_seconds)
            : "—"}
        </span>
      </TableCell>
      <TableCell>
        <input
          type="date"
          value={row.run_date}
          onChange={(e) => changeDate(e.target.value)}
          disabled={busy}
          title="The day this entry belongs to — change it to move the entry to another date"
          className="h-8 px-2 text-xs rounded-md border border-[var(--border)] bg-[var(--background)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
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
              className="p-1 rounded text-[var(--success)] hover:bg-[var(--success-bg)] cursor-pointer"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          )}
        </div>
      </TableCell>
      <TableCell>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title="Remove this entry"
          className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ */

export function ProgramSearch({ onPick }: { onPick: (p: AuditedProgramHit) => void }) {
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
        className="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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

/** Compact qty: integers as-is, else 2-dp without trailing zeros. */
function fmtQty(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
