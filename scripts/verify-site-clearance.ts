/**
 * Verifies the pure site-clearance helpers behind the "Site clearance pending"
 * pop-up and the Dispatches-panel status line (src/lib/site-clearance.ts).
 * No network, no API key. Run either way:
 *   npx tsx scripts/verify-site-clearance.ts
 *   node scripts/verify-site-clearance.ts     (Node 22.18+ strips the types)
 *
 * Checks: the scope labels, the pending / given / revoked / couldn't-check
 * decision (a failed check must still warn — never block; a revoked clearance
 * no longer counts), which clearance counts as the latest, and the exact texts
 * the factory sees, including the revocation notice before and after it is
 * acknowledged.
 */
import {
  CLEARANCE_SCOPE_LABEL,
  SITE_CLEARANCE_PROMPT_TITLE,
  clearanceScopeLabel,
  formatClearanceDate,
  revocationNeedsAck,
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
  code: null,
  recommended_scope: "full",
  note: null,
  cleared_by: "Ramesh",
  cleared_at: "2026-09-07T10:28:21.196553+00:00",
  created_at: "2026-09-07T10:31:00.263911+00:00",
  acknowledged_at: null,
  acknowledged_by: null,
  revoked_at: null,
  revoked_by: null,
  revoke_reason: null,
  revoke_acknowledged_at: null,
  revoke_acknowledged_by: null,
  ...p,
});
// A clearance Construction revoked (defaults: 30 Sep by Ravi, with a reason).
const revoked = (p: Partial<SiteClearance> = {}): SiteClearance =>
  row({
    code: "DCL-12",
    revoked_at: "2026-09-30T09:15:00+00:00",
    revoked_by: "Ravi",
    revoke_reason: "Shaft not ready",
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

console.log("[2] Pending / given / revoked decision");
eq("no rows → pending", siteClearanceStatus([]).state, "pending");
eq("null → pending", siteClearanceStatus(null).state, "pending");
eq("one row → given", siteClearanceStatus([row()]).state, "given");
eq("read ok, no rows → pending", siteClearanceStatusOf({ ok: true, clearances: [] }).state, "pending");
eq("read ok, rows → given", siteClearanceStatusOf({ ok: true, clearances: [row()] }).state, "given");
eq("read failed → unknown", siteClearanceStatusOf({ ok: false, error: "fetch failed" }).state, "unknown");
eq("pending → warn", warnBeforeDispatch({ state: "pending" }), true);
eq("failed check → still warn (never block, never skip)", warnBeforeDispatch({ state: "unknown" }), true);
eq("given → no pop-up", warnBeforeDispatch(siteClearanceStatus([row()])), false);
eq("the only clearance revoked → revoked, not given", siteClearanceStatus([revoked()]).state, "revoked");
eq("revoked → warn again", warnBeforeDispatch(siteClearanceStatus([revoked()])), true);
eq("all clearances revoked → revoked", siteClearanceStatus([revoked(), revoked()]).state, "revoked");
{
  // Revoked, then Construction cleared again: the new one is in force.
  const reCleared = row({ recommended_scope: "first", cleared_at: "2026-10-02T06:00:00+00:00" });
  const s = siteClearanceStatus([revoked(), reCleared]);
  ok("revoked + a newer clearance in force → given (the active one)", s.state === "given" && s.latest.id === reCleared.id);
  ok("… and the count covers clearances in force only", s.state === "given" && s.count === 1);
  eq("… so no pop-up", warnBeforeDispatch(s), false);
  // An older clearance still in force while a newer one was revoked.
  const olderActive = row({ cleared_at: "2026-09-01T10:00:00+00:00" });
  const newerRevoked = revoked({ cleared_at: "2026-09-05T10:00:00+00:00" });
  const s2 = siteClearanceStatus([newerRevoked, olderActive]);
  ok("an older clearance still in force keeps the job given", s2.state === "given" && s2.latest.id === olderActive.id);
  // A revocation that arrived before its clearance: cleared_* empty.
  const early = revoked({ cleared_at: null, cleared_by: null, created_at: "2026-09-30T09:16:00+00:00" });
  eq("revoked-before-cleared row → revoked", siteClearanceStatus([early]).state, "revoked");
}

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
  // Several revoked: the latest REVOCATION is carried.
  const r1 = revoked({ revoked_at: "2026-09-20T09:00:00+00:00", revoked_by: "First" });
  const r2 = revoked({ revoked_at: "2026-09-30T09:00:00+00:00", revoked_by: "Second" });
  for (const [label, rows] of [["newest first", [r2, r1]], ["oldest first", [r1, r2]]] as const) {
    const s = siteClearanceStatus(rows);
    ok(`revoked, ${label}: carries the latest revocation`, s.state === "revoked" && s.latest.id === r2.id);
  }
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
eq(
  "revoked line, not yet acknowledged",
  siteClearanceLine(siteClearanceStatus([revoked()]), day),
  "Site clearance (Construction): revoked 2026-09-30 by Ravi — Shaft not ready",
);
eq(
  "revoked line, acknowledged by a named operator",
  siteClearanceLine(
    siteClearanceStatus([revoked({ revoke_acknowledged_at: "2026-09-30T10:00:00+00:00", revoke_acknowledged_by: "Anita" })]),
    day,
  ),
  "Site clearance (Construction): revoked 2026-09-30 by Ravi — Shaft not ready (acknowledged by Anita)",
);
eq(
  "revoked line, acknowledged with no name on the device",
  siteClearanceLine(siteClearanceStatus([revoked({ revoke_acknowledged_at: "2026-09-30T10:00:00+00:00" })]), day),
  "Site clearance (Construction): revoked 2026-09-30 by Ravi — Shaft not ready (acknowledged)",
);
eq(
  "revoked line, no name / no reason → those parts are left out",
  siteClearanceLine(siteClearanceStatus([revoked({ revoked_by: " ", revoke_reason: null })]), day),
  "Site clearance (Construction): revoked 2026-09-30",
);
eq("unacknowledged revocation → Acknowledge shown", revocationNeedsAck(siteClearanceStatus([revoked()])), true);
eq(
  "acknowledged revocation → no Acknowledge",
  revocationNeedsAck(siteClearanceStatus([revoked({ revoke_acknowledged_at: "2026-09-30T10:00:00+00:00" })])),
  false,
);
eq("given → no Acknowledge", revocationNeedsAck(siteClearanceStatus([revoked(), row()])), false);
eq("nothing loaded yet → no Acknowledge", revocationNeedsAck(null), false);
eq("pop-up title", SITE_CLEARANCE_PROMPT_TITLE, "Site clearance pending");
eq(
  "pop-up body (pending)",
  siteClearancePromptMessage("RNLBLR-0110"),
  "Site clearance is pending at the Construction end for Job RNLBLR-0110. Do you want to continue?",
);
eq(
  "pop-up body (couldn't check) — same as pending",
  siteClearancePromptMessage("RNLBLR-0110", { state: "unknown" }),
  "Site clearance is pending at the Construction end for Job RNLBLR-0110. Do you want to continue?",
);
eq(
  "pop-up body (revoked)",
  siteClearancePromptMessage("RNLBLR-0110", siteClearanceStatus([revoked()]), day),
  "Site clearance is pending at the Construction end for Job RNLBLR-0110 — the last clearance was revoked on 2026-09-30. Do you want to continue?",
);

console.log("[5] Default date format");
{
  const shown = formatClearanceDate("2026-09-07T10:28:21.196553+00:00");
  ok("formats a real timestamp (has the year, not 'Invalid Date')", shown.includes("2026") && !/invalid/i.test(shown), shown);
  eq("unparseable value falls back to its date part", formatClearanceDate("2026-09-07 garbage"), "2026-09-07");
  const line = siteClearanceLine(siteClearanceStatus([row()]));
  ok("default line starts with 'Site clearance given '", line.startsWith("Site clearance given "), line);
  const revokedLine = siteClearanceLine(siteClearanceStatus([revoked()]));
  ok("default revoked line has the year", revokedLine.includes("2026") && revokedLine.includes("by Ravi"), revokedLine);
}

console.log(failures === 0 ? "\nAll site-clearance checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
