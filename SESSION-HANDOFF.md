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
- **Inventory demand visibility** (8a0f50d, 2026-06-11 evening, owner-requested):
  /inventory got MRP-style All/Make/Trade tabs + a "Demand" column & filter
  classifying every item by how it gets requirements — Jobs (category bound to a
  job-form BOM section or already on a job BOM) / Formula (program input or
  parts-list child) / No link / "—" for tooling. Computed in the search_inventory
  RPC (migration 018: 3 new defaulted params incl. p_bound_category_ids resolved
  app-side from BOM_SECTIONS). Owner picked 3-bucket model. M/T badge added to
  item detail header, Ctrl+K results, BOM-picker dropdown. Verified live: counts
  All 2,601/Make 1,556/Trade 1,044; Make+No-link=133, Trade+No-link=436 (exact
  SQL match). **The "No link" lists are the team's action queue** — those items
  can never appear in any plan until linked (or given a min stock; note 0 of them
  have reorder points set today). VERIFICATION TRAP (cost an hour): Claude-in-
  Chrome tabs are HIDDEN → hydration+effects stall → deep links look broken when
  they aren't. Screenshot first to foreground the tab; see memory env_preview_caveat.
- **Demand Flow Type manual marking** (5342be5): clicking the Demand badge on any
  /inventory row opens a menu — Auto (computed) / Jobs (direct) / Formula / No
  link. Stored in items.demand_override (migration 019, NULL = auto); RPC returns
  coalesce(override, computed) + demand_overridden, so filter/counts follow.
  Manual marks render with a pencil ✎ + dashed border; every change hits
  item_change_log (Daily Changes + undo verified live end-to-end).
- **Steel scrap on Programs to Run** (c1acf4e): an agent scanned ALL 347 sketch
  PDFs (TruTops SET-UP SCHEDULE; parser at pdf-dxf-pilot/extract_times.py +
  download_sketches.py, data at scripts/sketch-extract.json — all rerunnable).
  operations gained sheet_weight_kg / scrap_percent / scrap_weight_kg (migration
  020, applied by scripts/apply-sketch-extract.js); machining_time_seconds now
  set on all 347 sketch programs (40 filled, 1 corrected, 306 already exact —
  the existing values clearly came from these PDFs). /mrp/make-plan shows a
  "Steel scrap" summary card (plan-wide ~11.7%, 1,384 of 11,789 kg on today's
  plan) + per-program chips (green <8% / amber / red >15%). Display only — the
  locked optimizer untouched. Worst nests (audited!): CNC-106-SW-HARDWARE 36.5%,
  CNC-401-CRAIL-BRACKET-A 28.1%, CNC-172-HOME-GOVENOR-ARG 23.1% — overlaps the
  redesign shortlist (open thread 3); scrap data now ranks it by kg. NOTE: ~53
  programs in the plan have NO sketch attached → no time/scrap ("— time — scrap"
  chips); attaching their TruTops reports is the natural data-capture ask.

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
2. **6 sheets/day available**: have Sudhir audit these pending programs
   (ILP-proven saving; refreshed 2026-06-11 22:30 against the live 381-run plan —
   exact optimum drops to 375): CNC-103E-R1-SAFETY-1242X150-LASER (x4!),
   CNC-146B-ACO-LDP-NV-1000-2000-FIRE-D (x7!), CNC-248C-AT-LDP-NV-1000X2000-MS,
   CNC-232D-AT-LDP-MV-700X2000-SS-ROSE, CNC-261-MT-LP-PV-RH-800, CNC-262-MT-CP-PV-LH-800,
   CNC-131A, CNC-147A/147B-FIRE-D, CNC-235-AT-CDP-LV-700X2000-MS, CNC-241A-AT-CDP-LV-800X2000-SS-ROSE.
   The list shifts with demand — refresh anytime: `pdf-dxf-pilot/ilp/scrape_demand.py`
   (pulls live demand) then `deep_analysis.py` (venv .venvs/pdfdxf). The owner
   challenged the 381-run plan on 2026-06-11 evening; ILP PROVED 381 optimal for
   audited-only — the planner is not the bottleneck, audit coverage is.
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
8. ~~Branches~~ RESOLVED 2026-06-11: `feature/mrp-net-dispatch` (5008303,
   dispatch netting) is fully merged into main. `feature/perf-mumbai` still
   parked with one commit (Mumbai region pin + direct-to-storage uploads).
9. ~~Housekeeping~~ RESOLVED 2026-06-11: stale worktree metadata
   (`cabin-review`, `perf-mrp-review`) and three leftover clean/merged
   workflow worktrees deleted; git ops are quiet again. Still untracked
   scratch: `pdf-dxf-pilot/`, `scripts/*.json`, `a_copy.xlsx`.

## Perf deep-dive (2026-06-12 ~01:00) — THE structural finding

- **Proven root cause of "ERP is slow": Netlify runs the server functions in
  us-east-2 (Ohio); Supabase is ap-south-1 (Mumbai). `/api/diag` (new endpoint)
  measures it: ~270–335 ms PER DB QUERY.** DB itself is healthy (pg_stat: worst
  query family mean 45 ms). Pages chain 10–40 dependent queries → 3–14 s.
  - **THE FIX (owner one-click, not doable via MCP): Netlify app →
    lt-factory-erp → Project configuration → Functions → region → pick Mumbai
    (ap-south-1) or nearest Asia option, save, redeploy. Verify in seconds via
    https://lt-factory-erp.netlify.app/api/diag (region + ping should drop to
    ~10–20 ms).** Plan is Pro, so the setting should be available. If it isn't:
    the Vercel-Mumbai migration is already prepped on `feature/perf-mumbai`.
- Shipped meanwhile (7040b20 + 99b653b): `lib/supabase/fetch-all.ts`
  (fetchAllRanged — first page with exact count, remaining pages in ONE parallel
  burst) replacing every hot-path serial pager: mrp.ts (jobs/dispatch/BOM lines/
  per-item popover + the 4 full-table reads in /mrp/plan; local fetchAllRows
  helper deleted), production-plan.ts (parts lists/programs/outputs),
  inventory.ts (getItemsWithStock + facets), jobs.ts (list + import-meta),
  cabin.ts (type counts → parallel COUNT-only head queries, was fetching 6k+
  rows to count them). Output verified IDENTICAL vs old code (make-plan totals
  field-for-field; all 11 cabin counts). Left alone: next-code series scans in
  create-item paths (mutation-time one-offs).
- OPEN ANOMALY for daylight: /mrp/make-plan recomputes ~5–6 s on every request
  even warm, though the plan payload is only ~0.8 MB (under the 2 MB
  unstable_cache cap) and revalidate=1800. Suspect the cache write/read on the
  Netlify runtime — worth instrumenting AFTER the region flip (which makes each
  recompute cheap anyway).

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
