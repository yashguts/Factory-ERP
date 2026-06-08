"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { CabinJobListRow } from "@/lib/actions/cabin-jobs";

export function CabinJobsClient({ jobs }: { jobs: CabinJobListRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return jobs;
    return jobs.filter((j) => {
      const hay = `${j.job_number} ${j.customer_name ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [jobs, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" /> Cabin Jobs
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {jobs.length} cabin job{jobs.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button onClick={() => router.push("/cabin-jobs/new")}>
          <Plus size={16} className="mr-2" /> New Cabin Job
        </Button>
      </div>

      {jobs.length > 0 && (
        <div className="relative max-w-sm mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search job # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <ClipboardCheck size={40} className="mx-auto mb-3 text-[var(--muted-foreground)] opacity-50" />
          <p className="text-sm text-[var(--muted-foreground)]">
            {jobs.length === 0
              ? "No cabin jobs yet. Create one to start listing cabin items by type."
              : "No cabin jobs match your search."}
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((j) => (
                <TableRow
                  key={j.id}
                  className="cursor-pointer hover:bg-[var(--muted)]"
                  onClick={() => router.push(`/cabin-jobs/${j.id}`)}
                >
                  <TableCell className="font-mono text-sm font-medium">{j.job_number}</TableCell>
                  <TableCell className="text-sm">{j.customer_name || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.line_count}</TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {new Date(j.created_at).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
