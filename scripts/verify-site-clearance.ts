/**
 * Verifies the pure site-clearance helpers behind the "Site clearance pending"
 * pop-up and the Dispatches-panel status line (src/lib/site-clearance.ts).
 * No network, no API key. Run either way:
 *   npx tsx scripts/verify-site-clearance.ts
 *   node scripts/verify-site-clearance.ts     (Node 22.18+ strips the types)
 *
 * Checks: the scope labels, the pending / given / couldn't-check decision
 * (a failed check must still warn — never block), which clearance counts as
 * the latest, and the exact texts the factory sees.
 */
import {
  CLEARANCE_SCOPE_LABEL,
  SITE_CLEARANCE_PROMPT_TITLE,
  clearanceScopeLabel,
  formatClearanceDate,
  siteClearanceLine,
  siteClearancePromptMessage,
  siteClearanceStatus,
  siteClearanceStatusOf,
  warnBeforeDispatch,
  type SiteClearance,
} from "../src/lib/site-clearance.ts";

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) failures++;
};
const eq = (name: string, got: unknown, want: unknown) =>
  ok(name, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

let seq = 0;
const row = (p: Partial<SiteClearance> = {}): SiteClearance => ({
  id: `c${++seq}`,
  job_id: "job-1",
  recommended_scope: "full",
  note: null,
  cleared_by: "Ramesh",
  cleared_at: "2026-09-07T10:28:21.196553+00:00",
  created_at: "2026-09-07T10:31:00.263911+00:00",
  acknowledged_at: null,
  acknowledged_by: null,
  ...p,
});
// Deterministic date for the text checks (the UI formats in the viewer's locale).
const day = (iso: string) => iso.slice(0, 10);

console.log("[1] Scope labels");
eq("first", clearanceScopeLabel("first"), "First phase");
eq("first_and_second", clearanceScopeLabel("first_and_second"), "First & second phase");
eq("full", clearanceScopeLabel("full"), "Complete material");
eq("null scope → no label", clearanceScopeLabel(null), null);
eq("unknown scope → no label", clearanceScopeLabel("second"), null);
eq("prototype key is not a scope", clearanceScopeLabel("toString"), null);
eq("table covers exactly the three DB scopes", Object.keys(CLEARANCE_SCOPE_LABEL).sort().join(","), "first,first_and_second,full");

console.log("[2] Pending / given decision");
eq("no rows → pending", siteClearanceStatus([]).state, "pending");
eq("null → pending", siteClearanceStatus(null).state, "pending");
eq("one row → given", siteClearanceStatus([row()]).state, "given");
eq("read ok, no rows → pending", siteClearanceStatusOf({ ok: true, clearances: [] }).state, "pending");
eq("read ok, rows → given", siteClearanceStatusOf({ ok: true, clearances: [row()] }).state, "given");
eq("read failed → unknown", siteClearanceStatusOf({ ok: false, error: "fetch failed" }).state, "unknown");
eq("pending → warn", warnBeforeDispatch({ state: "pending" }), true);
eq("failed check → still warn (never block, never skip)", warnBeforeDispatch({ state: "unknown" }), true);
eq("given → no pop-up", warnBeforeDispatch(siteClearanceStatus([row()])), false);

console.log("[3] Latest clearance + count");
{
  const older = row({ recommended_scope: "full", cleared_at: "2026-09-01T19:46:36.10668+00:00" });
  const newer = row({ recommended_scope: "first_and_second", cleared_at: "2026-09-07T17:53:49.645337+00:00" });
  for (const [label, rows] of [["newest first", [newer, older]], ["oldest first", [older, newer]]] as const) {
    const s = siteClearanceStatus(rows);
    ok(`${label}: latest is the newest cleared_at`, s.state === "given" && s.latest.id === newer.id);
    ok(`${label}: count = 2`, s.state === "given" && s.count === 2);
  }
  // No cleared_at → falls back to when the ERP recorded it.
  const noStamp = row({ cleared_at: null, created_at: "2026-09-10T08:00:00+00:00" });
  const s2 = siteClearanceStatus([older, noStamp]);
  ok("missing cleared_at falls back to created_at", s2.state === "given" && s2.latest.id === noStamp.id);
  // Construction's own time wins over a later ERP record time.
  const backfilled = row({ cleared_at: "2026-08-17T14:28:05+00:00", created_at: "2026-08-29T20:36:00+00:00" });
  const fresh = row({ cleared_at: "2026-08-20T09:00:00+00:00", created_at: "2026-08-20T09:03:00+00:00" });
  const s3 = siteClearanceStatus([backfilled, fresh]);
  ok("orders by cleared_at, not created_at", s3.state === "given" && s3.latest.id === fresh.id);
}

console.log("[4] Texts the factory sees");
eq("pending line", siteClearanceLine({ state: "pending" }), "Site clearance (Construction): pending");
eq("couldn't-check line", siteClearanceLine({ state: "unknown" }), "Site clearance (Construction): couldn't check");
eq(
  "given line, one clearance",
  siteClearanceLine(siteClearanceStatus([row({ recommended_scope: "first" })]), day),
  "Site clearance given 2026-09-07 · First phase · by Ramesh",
);
eq(
  "given line, several clearances → latest + count",
  siteClearanceLine(
    siteClearanceStatus([
      row({ recommended_scope: "full", cleared_by: "Old Name", cleared_at: "2026-09-01T19:46:36+00:00" }),
      row({ recommended_scope: "first_and_second", cleared_by: "  Suresh  ", cleared_at: "2026-09-07T17:53:49+00:00" }),
    ]),
    day,
  ),
  "Site clearance given 2026-09-07 · First & second phase · by Suresh (2 clearances)",
);
eq(
  "no name / no scope → those parts are left out",
  siteClearanceLine(siteClearanceStatus([row({ recommended_scope: null, cleared_by: "  " })]), day),
  "Site clearance given 2026-09-07",
);
eq("pop-up title", SITE_CLEARANCE_PROMPT_TITLE, "Site clearance pending");
eq(
  "pop-up body",
  siteClearancePromptMessage("RNLBLR-0110"),
  "Site clearance is pending at the Construction end for Job RNLBLR-0110. Do you want to continue?",
);

console.log("[5] Default date format");
{
  const shown = formatClearanceDate("2026-09-07T10:28:21.196553+00:00");
  ok("formats a real timestamp (has the year, not 'Invalid Date')", shown.includes("2026") && !/invalid/i.test(shown), shown);
  eq("unparseable value falls back to its date part", formatClearanceDate("2026-09-07 garbage"), "2026-09-07");
  const line = siteClearanceLine(siteClearanceStatus([row()]));
  ok("default line starts with 'Site clearance given '", line.startsWith("Site clearance given "), line);
}

console.log(failures === 0 ? "\nAll site-clearance checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
