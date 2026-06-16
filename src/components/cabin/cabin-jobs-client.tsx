"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { Plus, Search, ClipboardCheck, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { EmptyState } from "@/components/ui/empty-state";
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
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  useUrlListSync({ q: search }, { q: "" });

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return jobs;
    return jobs.filter((j) => {
      const hay = `${j.job_number} ${j.customer_name ?? ""} ${j.platform ?? ""} ${j.side_panel_material ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [jobs, search]);

  return (
    <div>
      <PageHeader
        icon={<ClipboardCheck size={18} />}
        title="Cabin Jobs"
        meta={
          search.trim()
            ? `${filtered.length} of ${jobs.length} cabin job${jobs.length === 1 ? "" : "s"}`
            : `${jobs.length} cabin job${jobs.length === 1 ? "" : "s"}`
        }
        actions={
          <Button size="sm" onClick={() => router.push("/cabin-jobs/new")}>
            <Plus size={16} className="mr-1.5" /> New Cabin Job
          </Button>
        }
      />

      <Toolbar>
        <div className="relative w-full max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search job # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={jobs.length === 0}
            className="pl-9"
          />
        </div>
        <ToolbarSpacer />
      </Toolbar>

      {filtered.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<ClipboardCheck size={28} />}
            title={jobs.length === 0 ? "No cabin jobs yet" : "No cabin jobs match your search"}
            description={
              jobs.length === 0
                ? "Create one to start listing cabin items by type."
                : "Try a different job number or customer."
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Side Panel</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((j) => (
                <TableRow
                  key={j.id}
                  className="cursor-pointer hover:bg-[var(--muted)]"
                  onClick={() => router.push(`/cabin-jobs/${j.id}`)}
                >
                  <TableCell className="font-mono font-medium">{j.job_number}</TableCell>
                  <TableCell>{j.customer_name || "—"}</TableCell>
                  <TableCell className="font-mono text-[13px]">{j.platform || "—"}</TableCell>
                  <TableCell>{j.side_panel_material || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.line_count}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">
                    {new Date(j.created_at).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      title={`Clone ${j.job_number} into a new job`}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/cabin-jobs/new?from=${j.id}`);
                      }}
                    >
                      <Copy size={14} className="mr-1.5" /> Clone
                    </Button>
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
