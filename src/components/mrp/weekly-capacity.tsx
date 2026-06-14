"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

const machineLabel = (m: string) => m.replace(/^cnc_/, "").replace(/_/g, " ");
const CAP_KEY = "mrp-machine-capacity-hrs";

const fmtH = (h: number) => (h <= 1e-9 ? "—" : h < 10 ? h.toFixed(1) : Math.round(h).toString());

/**
 * Per-machine weekly LOAD = scheduled runs × recorded machining time, read off
 * the same once-optimised weekly run allocation (the locked optimiser is NOT
 * touched — this only reads its output). An optional per-machine capacity
 * (hours/week, remembered on this device) flags overloaded weeks in red.
 */
export function WeeklyCapacity({ plan }: { plan: WeeklyMrpPlan }) {
  const weeks = plan.weeks;

  const { machines, hoursByMachine, totalsByMachine, missingTime } = useMemo(() => {
    const byMachine = new Map<string, number[]>();
    let missing = 0;
    for (const p of plan.programs) {
      if (p.totalRuns <= 0) continue;
      const arr = byMachine.get(p.machine) ?? weeks.map(() => 0);
      const secs = p.machiningTimeSeconds ?? 0;
      if (p.machiningTimeSeconds == null) missing += 1;
      for (let i = 0; i < weeks.length; i++) arr[i] += (p.runsPerWeek[i] || 0) * secs / 3600;
      byMachine.set(p.machine, arr);
    }
    const machines = Array.from(byMachine.keys()).sort();
    const totals = new Map<string, number>();
    for (const m of machines) totals.set(m, byMachine.get(m)!.reduce((s, h) => s + h, 0));
    return { machines, hoursByMachine: byMachine, totalsByMachine: totals, missingTime: missing };
  }, [plan, weeks]);

  const [cap, setCap] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(CAP_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const setCapFor = (m: string, v: number) => {
    setCap((prev) => {
      const next = { ...prev, [m]: v };
      try {
        localStorage.setItem(CAP_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private-mode */
      }
      return next;
    });
  };

  if (machines.length === 0) {
    return (
      <div className="card-surface p-6 text-center text-sm text-[var(--muted-foreground)]">
        No machine load to show in this window.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {missingTime > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--warning)]">
          <AlertTriangle size={14} />
          {missingTime} scheduled program{missingTime === 1 ? "" : "s"} have no recorded machining time — the load below is an underestimate for those machines.
        </div>
      )}

      <div className="card-surface overflow-hidden">
        <Table density="compact">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Machine</TableHead>
              <TableHead className="text-right">Cap h/wk</TableHead>
              {weeks.map((w) => (
                <TableHead key={w.key} className="text-right">{w.label}</TableHead>
              ))}
              <TableHead className="text-right">Total h</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {machines.map((m) => {
              const hours = hoursByMachine.get(m)!;
              const capH = cap[m] || 0;
              return (
                <TableRow key={m}>
                  <TableCell className="font-medium capitalize">{machineLabel(m)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      size="sm"
                      type="number"
                      min={0}
                      value={capH || ""}
                      placeholder="—"
                      className="w-16 text-right ml-auto"
                      onChange={(e) => setCapFor(m, Number(e.target.value))}
                      title="Available machine-hours per week (this device only)"
                    />
                  </TableCell>
                  {hours.map((h, i) => {
                    const over = capH > 0 && h > capH + 1e-9;
                    return (
                      <TableCell
                        key={i}
                        className={cn(
                          "text-right tabular-nums",
                          over
                            ? "text-[var(--destructive)] font-semibold bg-[var(--destructive-bg)]"
                            : h > 1e-9
                              ? ""
                              : "text-[var(--muted-foreground)]",
                        )}
                      >
                        {fmtH(h)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtH(totalsByMachine.get(m)!)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-[var(--muted-foreground)]">
        Planned machine-hours = scheduled runs × recorded machining time, from the same
        once-optimised weekly run allocation. Set a capacity (hours/week) per machine to flag
        overloaded weeks in red. Capacity is remembered on this device only.
      </p>
    </div>
  );
}
