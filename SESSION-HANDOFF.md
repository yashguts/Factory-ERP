# Session Handoff — 2026-06-11

> For the next Claude session. Read `CLAUDE.md` first (deep technical reference);
> this file is the *what-just-happened and what's-open* picture. The previous
> session ran ~24h (overnight UX overhaul + a day of owner-driven iteration).

## State: everything below is SHIPPED, LIVE and verified on main

- **UX overhaul (overnight)**: instant loading skeletons everywhere; URL-backed
  list state (Back never loses filters — `use-url-list-state.ts`, follow it for
  any new list); app-wide toasts (`useToast`, never window.alert); Ctrl+K global
  search; Sent/Required wording on jobs; stale-deploy auto-heal (chunk errors
  reload once; friendly error screens). Perf: detail pages no longer haul the
  full catalog (`getItemRefs`); item detail ~0.7s warm.
- **Sections removed at owner's request**: Dashboard (/ → redirects to /jobs),
  Bill of Materials, Settings. DO NOT rebuild a dashboard unasked.
- **MRP "Programs to run" = owner-locked portfolio optimizer** (see CLAUDE.md
  "do not weaken" block): sheet-minimising selection (dominance pruning,
  5-strategy portfolio, fixpoint trim, remove/repair/add local search,
  coverage-verified, honest "saves N vs simple pick" badge), category grouping,
  ALL outputs shown as "makes ×N · M counted" (smallest-producer-first credit),
  thickness chips + "Sheets to cut" summary, per-program "Don't run" exclusions
  (?exclude= URL param, not persisted). Another session added machine-time
  (operations.machining_time_seconds) + a sheet filter on the same page.
- **ILP optimality proofs** (offline tooling `pdf-dxf-pilot/ilp/`, venv
  `C:\Users\yash_\.venvs\pdfdxf`): three consecutive days the live plan equalled
  the exact CBC optimum (348/374/373 sheets). Selection is a solved problem.
  `deep_analysis.py` also does audited-vs-pending comparison + last-run waste.
- **Daily Program Runs** (`/program-runs`): factory logbook — date + audited-only
  program search + counts + machine-time totals. Table `operation_runs`
  (UNIQUE op+date; FK blocks deleting programs with history). NO inventory
  effects (future phase). Natural next step: plan-vs-actual view.
- **Cabin fixes**: cabin-job pickers fast (<1s, was 4-12s) + sub-type words
  match (fan/ACO/...) + family-less hand-added items findable; ~1,031 panel
  finish variants created by SQL fan-out (Side Panel/Front Wall/Car Linton,
  owner-approved rules — see memory project_cabin_side_panels).
- **MRP popover consistency fix** (f371490): hover now applies the table's exact
  rules (in_production + cutoff + stage scoping + dispatch netting).

## MRP math audit (2026-06-11) — VERDICT: numbers trustworthy for purchasing

An adversarial agent re-derived all MRP numbers from the spec with independent
SQL: **all 374 item rows matched exactly** (Required/Stock/Shortfall + popover
equivalence + 8 varied spot checks); over-dispatch, duplicate stock rows,
category near-misses, NULL-date and NULL-procurement traps all EMPTY today.
Fixed immediately after the audit (same session): buy-list `/mrp/plan` program
choice was nondeterministic + could pick unaudited programs (now audited-first,
id-tiebreak); popover showed the previous date's jobs after changing the cutoff
(client cache now resets); `reportedSheets` counted no-input programs as free
(now 1 sheet/run like selection). REMAINING from the audit (latent, all vacuous
today — close when convenient):
- 49 active items have NO category → invisible in Trade AND Make tabs (only
  "All") if they ever land on a BOM. Owner should assign categories.
- Jobs with NULL requirement_dispatch_date vanish from MRP when a cutoff is set
  (0 such jobs exist; form requires it; consider a DB NOT NULL or an /mrp banner).
- Buy list silently drops demand items not in getItemsWithStock (inactive/cabin)
  — surface under "cannot explode" instead.
- Make-plan "blocked" is decided before stock netting (edge case, 0 real hits).
- /mrp "Sufficient Only" excludes stock==required items; URL accepts show=zero
  but no dropdown option exists (cosmetic).
- By design (owner aware): first_phase jobs hide their 2nd-phase demand until
  the stage flips — e.g. ~1,856 units Wire Rope Main currently not counted.

## Open threads, in rough priority order
2. **6 sheets/day available**: owner should have Sudhir audit these 9 pending
   programs (ILP-proven saving): CNC-103E-R1-SAFETY-1242X150-LASER,
   CNC-248C-AT-LDP-NV-1000X2000-MS, CNC-232D-AT-LDP-MV-700X2000-SS-ROSE,
   CNC-261-MT-LP-PV-RH-800, CNC-129, CNC-131A, CNC-147-FIRE-DO, CNC-233D,
   CNC-262. Planner picks them up automatically once audited.
3. **Nest redesign shortlist** (~22 sheets/day theoretical): worst last-run
   waste: CNC-170-HOME-COUNTER-850, CNC-128A ACO LDP MV SS, CNC-163A SAFETY
   HOME 720, CNC-105-POST-SUPPORT-COLLAPSIBLE, CNC-LC-100/LC101 family.
4. **Weight-based make-plan costing** (owner's wish, ~one evening): sheet names
   carry dims×thickness (`1250x2500x3.0mm`) → kg of steel as the objective
   instead of sheet count. All audited programs currently cost exactly
   1 sheet/run, so count==runs today.
5. **Plan-vs-actual**: join /program-runs vs /mrp/make-plan per day.
6. **Cabin Support category is EMPTY** (0 items) — import pending, owner aware.
7. **PDF→DXF thread**: program sketches are TruTops reports (no vector);
   real geometry = .GEO files on factory T:\ — owner to get them from Sudhir;
   then batch GEO→DXF is easy. Also on offer: full parts-index extraction from
   all 294 sketch PDFs; and a DXF+qty → nesting-drawing generator (ILP-adjacent,
   verified offline). See memory reference_program_sketch_pdfs.
8. **Branches**: `feature/mrp-net-dispatch` (pushed by the parallel session —
   status unknown, check before assuming), `feature/perf-mumbai` (parked).
9. Housekeeping: stale `.git/worktrees/{cabin-review,perf-mrp-review}` cause
   permission-denied noise on every git op (locked by something; harmless).
   Untracked scratch: `pdf-dxf-pilot/`, `scripts/*.json`, `a_copy.xlsx`.

## Working agreements (hard-won today)

- TWO sessions may push to main concurrently — ALWAYS `git pull --rebase` before
  push; expect the remote to have moved.
- Verify on the LIVE deploy, not local (OneDrive breaks dev server); commit
  messages via `git commit -F .git/COMMIT_MSG_TMP` (inline here-strings mangle).
- Claude-in-Chrome CDP clicks are unreliable on this app (extension overlay
  eats them; screenshot timeouts ≠ real freezes). Verify via HTTP timing,
  targeted JS in the page, SQL, or fresh-tab screenshots.
- Business rules are LOCKED (dispatch ≠ stock deduction, job-creation flow,
  make-plan optimizer contract). Confusion = presentation problem.
- Data fan-outs / bulk edits: SQL migration via Supabase MCP, preview counts
  first, follow existing naming conventions EXACTLY (they differ per type —
  e.g. Car Linton embeds material inside the name).
