"use client";

import { Badge } from "@/components/ui/badge";
import type { Confidence } from "@/components/jobs/autofill-types";

const MAP: Record<Confidence, { variant: "green" | "amber" | "red"; label: string }> = {
  high: { variant: "green", label: "High" },
  medium: { variant: "amber", label: "Medium" },
  low: { variant: "red", label: "Low — verify" },
};

export function ConfidenceBadge({ level, title }: { level: Confidence; title?: string }) {
  const m = MAP[level];
  return (
    <Badge variant={m.variant} className="text-[10px] px-1.5" title={title}>
      {m.label}
    </Badge>
  );
}

export function Provenance({ jobs }: { jobs: string[] }) {
  if (!jobs.length) return null;
  const shown = jobs.slice(0, 3).join(", ");
  const more = jobs.length > 3 ? ` +${jobs.length - 3}` : "";
  return (
    <span
      className="text-[10px] text-[var(--muted-foreground)] truncate"
      title={`Learned from jobs: ${jobs.join(", ")}`}
    >
      from {shown}{more}
    </span>
  );
}
