import { redirect } from "next/navigation";

// Retired 2026-07-04 — Packing List R1 lives natively inside Job Orders now
// (each job's list at /jobs/[id]/items). The shared template editor survives at
// /packing-list-r1/template.
export default function PackingListR1Retired() {
  redirect("/jobs");
}
