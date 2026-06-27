"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PackageCheck, Pencil, Search, ArrowRight } from "lucide-react";
import type { R1ListSummary } from "@/lib/actions/packing-list-r1";

interface SlimJob {
  id: string;
  job_number: string;
  customer_name: string | null;
}

export function LandingClient({
  lists,
  jobs,
}: {
  lists: R1ListSummary[];
  jobs: SlimJob[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const existing = useMemo(() => new Set(lists.map((l) => l.jobId)), [lists]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return jobs
      .filter(
        (j) =>
          j.job_number.toLowerCase().includes(s) ||
          (j.customer_name ?? "").toLowerCase().includes(s),
      )
      .slice(0, 25);
  }, [q, jobs]);

  return (
    <>
      <PageHeader
        title="Packing List R1"
        meta={`${lists.length} job ${lists.length === 1 ? "list" : "lists"}`}
        icon={<PackageCheck size={18} />}
        actions={
          <Link href="/packing-list-r1/template">
            <Button variant="secondary" size="sm">
              <Pencil size={15} /> Edit Template
            </Button>
          </Link>
        }
      />

      {/* Start / open a job */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 mb-5">
        <div className="text-sm font-medium mb-2">Create / open a job packing list</div>
        <div className="relative max-w-xl">
          <Search
            size={15}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a job by number or customer…"
            className="pl-8"
          />
        </div>
        {filtered.length > 0 && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
            {filtered.map((j) => (
              <button
                key={j.id}
                onClick={() => router.push(`/packing-list-r1/${j.id}`)}
                className="w-full text-left px-3 py-2 hover:bg-[var(--muted)] flex items-center gap-2"
              >
                <span className="font-mono text-sm font-medium">{j.job_number}</span>
                <span className="text-xs text-[var(--muted-foreground)] truncate flex-1">
                  {j.customer_name}
                </span>
                {existing.has(j.id) && (
                  <span className="text-[10px] rounded bg-[var(--muted)] px-1.5 py-0.5">
                    has list
                  </span>
                )}
                <ArrowRight size={14} className="text-[var(--muted-foreground)]" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Existing lists */}
      <div className="text-sm font-medium mb-2">Existing packing lists</div>
      {lists.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          No packing lists yet. Search a job above to create one.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[var(--muted-foreground)]">
              <tr>
                <th className="text-left font-medium px-3 py-2">Job</th>
                <th className="text-left font-medium px-3 py-2">Customer</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-right font-medium px-3 py-2">Lines</th>
                <th className="text-right font-medium px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {lists.map((l) => (
                <tr
                  key={l.jobId}
                  onClick={() => router.push(`/packing-list-r1/${l.jobId}`)}
                  className="cursor-pointer hover:bg-[var(--muted)]"
                >
                  <td className="px-3 py-2 font-mono font-medium">{l.jobNumber ?? "—"}</td>
                  <td className="px-3 py-2 truncate max-w-[280px]">{l.customerName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium",
                        l.status === "final"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.lineCount}</td>
                  <td className="px-3 py-2 text-right text-xs text-[var(--muted-foreground)]">
                    {new Date(l.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
