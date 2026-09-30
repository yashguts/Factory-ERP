/**
 * Verifies the pure site-survey helpers behind the "Site survey (Construction)"
 * card on the job page (src/lib/site-survey.ts). No network, no API key.
 * Run either way:
 *   npx tsx scripts/verify-site-survey.ts
 *   node scripts/verify-site-survey.ts     (Node 22.18+ strips the types)
 *
 * Checks: parsing the version-1 payload (and surviving odd payloads), latest vs
 * history, the ✓ / ✗ / — mapping, the heading colour, the line texts, the
 * video duration format, and version 2: YES / NO sub-points (listed only when
 * a point has 2 or more) and photos / videos grouped under their sub-point —
 * while a version-1 payload stays exactly as before.
 */
import {
  NO_SURVEY_TEXT,
  RETROSPECTIVE_TEXT,
  SURVEY_CARD_TITLE,
  answerTick,
  checkpointTick,
  distanceText,
  earlierSurveysLabel,
  expectedReadyText,
  formatDuration,
  formatSurveyDate,
  groupSurveyMedia,
  nestedSubpoints,
  overallLabelOf,
  splitSurveys,
  surveyByLine,
  surveyHeading,
  surveyTone,
  toSurveyView,
  videoCaption,
  type SiteSurveyRow,
} from "../src/lib/site-survey.ts";

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) failures++;
};
const eq = (name: string, got: unknown, want: unknown) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  ok(name, same, same ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// The contract's version-1 example, trimmed to what the card uses.
const CP = (key: string, label: string, result: "YES" | "NO" | null, status_label: string | null, remark: string | null = null) =>
  ({ key, label, status: status_label?.toUpperCase() ?? null, status_label, result, remark });
const payload = {
  version: 1,
  survey_ref: "6042",
  survey_no: 1,
  kind: "INITIAL",
  construction_job: "CXJ-754",
  overall_result: "PARTIAL",
  overall_label: "Partially ready",
  surveyed_by: "Sourav Sardar",
  submitted_at: "2026-09-29T17:47:42.951594+00:00",
  distance_m: 12.4,
  accuracy_m: 28,
  expected_ready_date: "2026-10-15",
  note: "Shaft plaster pending on 3rd floor",
  retrospective: false,
  checkpoints: [
    CP("PIT", "Pit condition", "YES", "OK"),
    CP("OVERHEAD", "Overhead", "YES", "OK"),
    CP("SHAFT", "Shaft", "NO", "Not ready", "Plaster pending"),
    CP("ELECTRICAL", "Electrical", null, null),
    CP("STORAGE", "Storage", "YES", "Ready"),
    CP("OTHER_INFRA", "Other infrastructure", "NO", "Not OK", "No scaffolding"),
  ],
  media: [
    { kind: "photo", checkpoint: "PIT", checkpoint_label: "Pit condition", url: "https://lt-construction.netlify.app/e/" + "a".repeat(64), captured_at: "2026-09-29T17:40:00+00:00", duration_ms: null },
    { kind: "video", checkpoint: "SHAFT", checkpoint_label: "Shaft", url: "https://lt-construction.netlify.app/e/" + "b".repeat(64), captured_at: null, duration_ms: 14000 },
    { kind: "photo", checkpoint: null, checkpoint_label: null, url: "https://lt-construction.netlify.app/e/" + "c".repeat(64), captured_at: null, duration_ms: null },
    { kind: "photo", url: "javascript:alert(1)" },
    { kind: "photo", url: "http://insecure.example/x.jpg" },
    { kind: "audio", url: "https://lt-construction.netlify.app/e/" + "d".repeat(64) },
  ],
  counts: { yes: 3, no: 2, not_checked: 1, photos: 2, videos: 1 },
};
const row = (p: Partial<SiteSurveyRow> = {}): SiteSurveyRow => ({
  id: "s1",
  survey_ref: "6042",
  survey_no: 1,
  overall_result: "PARTIAL",
  submitted_at: "2026-09-29T17:47:42.951594+00:00",
  received_at: "2026-09-29T17:48:00+00:00",
  updated_at: null,
  payload,
  ...p,
});
// Deterministic formatters for the text checks (the UI uses the viewer's locale).
const dt = (iso: string) => iso.slice(0, 16).replace("T", " ");
const d = (s: string) => s;

console.log("[1] Parsing the version-1 payload");
{
  const v = toSurveyView(row());
  eq("heading fields", [v.surveyNo, v.overallResult, v.overallLabel], [1, "PARTIAL", "Partially ready"]);
  eq("who / where / when", [v.surveyedBy, v.distanceM, v.accuracyM, v.expectedReadyDate], ["Sourav Sardar", 12.4, 28, "2026-10-15"]);
  eq("the 6 checkpoints, in the order sent", v.checkpoints.map((c) => c.key), ["PIT", "OVERHEAD", "SHAFT", "ELECTRICAL", "STORAGE", "OTHER_INFRA"]);
  eq("a not-checked checkpoint reads 'Not checked'", [v.checkpoints[3].result, v.checkpoints[3].statusLabel], [null, "Not checked"]);
  eq("the remark is kept", v.checkpoints[2].remark, "Plaster pending");
  eq("photos (https only; javascript:/http:/unknown kinds dropped)", v.photos.length, 2);
  eq("videos", [v.videos.length, v.videos[0].durationMs, v.videos[0].checkpointLabel], [1, 14000, "Shaft"]);
  eq("note + retrospective", [v.note, v.retrospective], ["Shaft plaster pending on 3rd floor", false]);
}
{
  const odd = toSurveyView(row({ payload: "not an object", survey_no: null, overall_result: null }));
  eq("a garbage payload still renders (no checkpoints, no media)", [odd.checkpoints.length, odd.photos.length, odd.videos.length, odd.overallLabel], [0, 0, 0, null]);
  const noLabel = toSurveyView(row({ payload: { ...payload, overall_label: null }, overall_result: "NOT_READY" }));
  eq("missing overall_label → derived from the result", noLabel.overallLabel, "Not ready");
  eq("overall label lookup ignores prototype keys", overallLabelOf("toString"), null);
  const retro = toSurveyView(row({ payload: { ...payload, retrospective: true } }));
  eq("retrospective flag", retro.retrospective, true);
}

console.log("[2] Latest vs history");
{
  const a = toSurveyView(row({ id: "a", submitted_at: "2026-09-01T10:00:00+00:00" }));
  const b = toSurveyView(row({ id: "b", submitted_at: "2026-09-29T10:00:00+00:00" }));
  const c = toSurveyView(row({ id: "c", submitted_at: "2026-09-15T10:00:00+00:00" }));
  const split = splitSurveys([a, b, c]);
  eq("newest by submitted_at on top, whatever the order", split.latest?.id, "b");
  eq("the rest newest first", split.earlier.map((s) => s.id), ["c", "a"]);
  eq("no surveys → nothing on top", splitSurveys([]).latest, null);
  eq("earlier label", earlierSurveysLabel(2), "Earlier surveys (2)");
}

console.log("[3] ✓ / ✗ / — and the heading colour");
eq("YES → green ✓", [checkpointTick("YES").symbol, checkpointTick("YES").tone], ["✓", "yes"]);
eq("NO → red ✗", [checkpointTick("NO").symbol, checkpointTick("NO").tone], ["✗", "no"]);
eq("null → grey —, Not checked", [checkpointTick(null).symbol, checkpointTick(null).tone, checkpointTick(null).label], ["—", "none", "Not checked"]);
eq("anything else → grey —", checkpointTick("MAYBE").tone, "none");
eq("READY → green", surveyTone("READY"), "ready");
eq("PARTIAL → amber", surveyTone("PARTIAL"), "partial");
eq("NOT_READY → red", surveyTone("NOT_READY"), "not_ready");
eq("no result → neutral", surveyTone(null), "none");

console.log("[4] Texts the factory sees");
eq("card title", SURVEY_CARD_TITLE, "Site survey (Construction)");
eq("no survey", NO_SURVEY_TEXT, "No site survey from Construction yet.");
eq("retrospective", RETROSPECTIVE_TEXT, "Recorded as completed without a site visit");
eq("heading", surveyHeading({ surveyNo: 1, overallLabel: "Ready" }), "Site survey #1 — Ready");
eq("heading without a number", surveyHeading({ surveyNo: null, overallLabel: "Not ready" }), "Site survey — Not ready");
eq("heading without a result", surveyHeading({ surveyNo: 2, overallLabel: null }), "Site survey #2");
eq(
  "by-line, all parts",
  surveyByLine({ surveyedBy: "Sourav Sardar", submittedAt: "2026-09-29T17:47:42+00:00", distanceM: 12.4 }, dt),
  "by Sourav Sardar · 2026-09-29 17:47 · 12 m from the site",
);
eq(
  "by-line, no name / no distance",
  surveyByLine({ surveyedBy: null, submittedAt: "2026-09-29T17:47:42+00:00", distanceM: null }, dt),
  "2026-09-29 17:47",
);
eq("distance rounds", [distanceText(12.5), distanceText(0.4), distanceText(1520)], ["13 m from the site", "0 m from the site", "1,520 m from the site"]);
eq("no / bad distance → left out", [distanceText(null), distanceText(-3), distanceText(Number.NaN)], [null, null, null]);
eq("expected ready", expectedReadyText({ expectedReadyDate: "2026-10-15" }, d), "Expected ready by 2026-10-15");
eq("no expected date → nothing", expectedReadyText({ expectedReadyDate: null }, d), null);
{
  const shown = formatSurveyDate("2026-10-15");
  const want = new Date(2026, 9, 15).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  eq("a date-only value stays on its calendar day", shown, want);
}

console.log("[5] Video duration");
eq("14 s", formatDuration(14000), "0:14");
eq("0 s", formatDuration(0), "0:00");
eq("75 s", formatDuration(75000), "1:15");
eq("over an hour", formatDuration(3723000), "1:02:03");
eq("rounds to the second", formatDuration(14600), "0:15");
eq("missing / bad → empty", [formatDuration(null), formatDuration(-1), formatDuration(Number.NaN)], ["", "", ""]);
eq("video caption", videoCaption({ durationMs: 14000 }), "Video · 0:14");
eq("video caption without a duration", videoCaption({ durationMs: null }), "Video");

console.log("[6] Version 1 stays exactly as before");
{
  const v1 = toSurveyView(row());
  eq("no sub-points on any point", v1.checkpoints.map((c) => c.subpoints.length), [0, 0, 0, 0, 0, 0]);
  eq("nothing nested under any point", v1.checkpoints.map((c) => nestedSubpoints(c).length), [0, 0, 0, 0, 0, 0]);
  const m = groupSurveyMedia(v1);
  eq("no sub-point groups", m.groups.length, 0);
  eq("every photo stays in the plain grid, in order", m.photos.map((p) => p.url), v1.photos.map((p) => p.url));
  eq("every video stays in the plain grid, in order", m.videos.map((p) => p.url), v1.videos.map((p) => p.url));
}

console.log("[7] Version 2: sub-points and grouped media");
{
  const SP = (key: string, label: string, answer: "YES" | "NO" | null) => ({ key, label, answer, result: answer });
  const url = (c: string) => "https://lt-construction.netlify.app/e/" + c.repeat(64);
  const v2 = {
    ...payload,
    version: 2,
    checkpoints: [
      { ...CP("PIT", "Pit condition", "NO", "Not OK", "Water in the pit"), subpoints: [SP("PIT_RUBBISH_CLEAR", "Clear of rubbish", "YES"), SP("PIT_DRY", "Dry, no water", "NO"), SP("PIT_DEPTH", "Depth as per drawing", null)] },
      { ...CP("OVERHEAD", "Overhead", "YES", "OK"), subpoints: [SP("OH_HOOK", "Lifting hook fixed", "YES"), SP("OH_HEIGHT", "Headroom as per drawing", "YES")] },
      { ...CP("SHAFT", "Shaft", "NO", "Not ready"), subpoints: [] },
      { ...CP("ELECTRICAL", "Electrical", null, null), subpoints: [SP("EL_SUPPLY", "3-phase supply", null), SP("EL_DB", "DB near machine room", null)] },
      { ...CP("STORAGE", "Storage", "YES", "Ready"), subpoints: [SP("ST_ROOM", "Lockable room", "YES"), SP("ST_DRY", "Dry floor", "YES")] },
      { ...CP("OTHER_INFRA", "Other infrastructure", "NO", "Not OK"), subpoints: [SP("OTHER_INFRA_OK", "Other infrastructure available", "NO")] },
    ],
    media: [
      { kind: "photo", checkpoint: "PIT", checkpoint_label: "Pit condition", subpoint: "PIT_DRY", subpoint_label: "Dry, no water", url: url("1"), captured_at: null, duration_ms: null },
      { kind: "photo", checkpoint: "PIT", checkpoint_label: "Pit condition", subpoint: "PIT_RUBBISH_CLEAR", subpoint_label: "Clear of rubbish", url: url("2"), captured_at: null, duration_ms: null },
      { kind: "video", checkpoint: "PIT", checkpoint_label: "Pit condition", subpoint: "PIT_DRY", subpoint_label: "Dry, no water", url: url("3"), captured_at: null, duration_ms: 9000 },
      { kind: "photo", checkpoint: "OTHER_INFRA", checkpoint_label: "Other infrastructure", subpoint: "OTHER_INFRA_OK", subpoint_label: "Other infrastructure available", url: url("4"), captured_at: null, duration_ms: null },
      { kind: "photo", checkpoint: "SHAFT", checkpoint_label: "Shaft", subpoint: null, subpoint_label: null, url: url("5"), captured_at: null, duration_ms: null },
      { kind: "video", checkpoint: null, checkpoint_label: null, subpoint: null, subpoint_label: null, url: url("6"), captured_at: null, duration_ms: 14000 },
      { kind: "photo", checkpoint: null, checkpoint_label: null, subpoint: "ST_DRY", subpoint_label: null, url: url("7"), captured_at: null, duration_ms: null },
      { kind: "photo", checkpoint: "PIT", checkpoint_label: "Pit condition", subpoint: "PIT_LADDER", subpoint_label: "Pit ladder", url: url("8"), captured_at: null, duration_ms: null },
    ],
    counts: { ...payload.counts, subpoints_yes: 5, subpoints_no: 2, subpoints_not_checked: 3 },
  };
  const v = toSurveyView(row({ payload: v2 }));
  const pit = v.checkpoints[0];
  eq("sub-points parsed in order", pit.subpoints.map((s) => `${s.key}:${s.answer}`), ["PIT_RUBBISH_CLEAR:YES", "PIT_DRY:NO", "PIT_DEPTH:null"]);
  eq("a point with 3 sub-points lists them", nestedSubpoints(pit).map((s) => s.label), ["Clear of rubbish", "Dry, no water", "Depth as per drawing"]);
  eq("sub-point ticks ✓ / ✗ / —", pit.subpoints.map((s) => answerTick(s.answer).symbol), ["✓", "✗", "—"]);
  eq("sub-point tick colours", pit.subpoints.map((s) => answerTick(s.answer).tone), ["yes", "no", "none"]);
  eq("sub-point tick labels", pit.subpoints.map((s) => answerTick(s.answer).label), ["Yes", "No", "Not checked"]);
  eq("answer missing → falls back to result", toSurveyView(row({ payload: { ...v2, checkpoints: [{ ...v2.checkpoints[0], subpoints: [{ key: "K", label: "L", result: "YES" }] }] } })).checkpoints[0].subpoints[0].answer, "YES");
  eq("a point with no sub-points lists nothing", nestedSubpoints(v.checkpoints[2]).length, 0);
  eq("OTHER_INFRA's single sub-point: nothing nested (the point's own ✓ / ✗ is enough)", nestedSubpoints(v.checkpoints[5]).length, 0);
  const m = groupSurveyMedia(v);
  eq(
    "groups in point / sub-point order (unknown sub-point last)",
    m.groups.map((g) => g.caption),
    ["Pit condition · Clear of rubbish", "Pit condition · Dry, no water", "Storage · Dry floor", "Other infrastructure", "Pit condition · Pit ladder"],
  );
  eq("a group holds its photos and videos", [m.groups[1].photos.length, m.groups[1].videos.length], [1, 1]);
  eq("media without a sub-point stay in the plain grids", [m.photos.map((p) => p.checkpointLabel), m.videos.length], [["Shaft"], 1]);
  eq("a media item missing its point key is matched by its sub-point", m.groups[2].photos[0].url, url("7"));
}

console.log(failures === 0 ? "\nAll site-survey checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
