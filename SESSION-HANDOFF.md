# Session Handoff — 2026-06-16 (MRP Make/Trade split + weekly-plan redesign + component demand)

> For the next Claude session. Read **CLAUDE.md** first. Working dir is on **`main`**;
> every change below is committed and pushed to `main` (Netlify auto-deploys, ~1 min).
> Commits go out via `git push origin HEAD:main`; if it's rejected, `git fetch` +
> `git rebase origin/main` then push (origin moved once when the owner pushed a
> cabin-jobs commit — no conflict, MRP files weren't touched).

## ⚠️ Environment gotcha that shaped the whole session
**Local dev/preview is BROKEN on this OneDrive setup** — the page hydration stalls,
`preview_screenshot` times out, navigation lands on a half-rendered shell. I could NOT
visually verify any UI change. Workflow that actually worked: `npx tsc --noEmit` +
`npm run build` for correctness, **mockups via the `visualize` tool for owner sign-off
before building**, and the owner sends **PDFs of the deployed page** to point at issues
(render them with `python -c "import fitz; d=fitz.open('x.pdf'); d[0].get_pixmap(matrix=fitz.Matrix(2,2)).save('x.png')"` then Read the PNG). Also: I pushed many deploys
back-to-back and the owner hit **stale-tab "looks broken"** errors several times — a
hard-refresh fixed each. Don't trust "it looks crazy" reports until after a hard refresh.

## 🔴 OPEN — needs action next session

1. **SA-DC-078 "Safety Guide Shoe Main Std" is still NOT scheduled in Programs-to-run.**
   It now has demand (component rules, below) but is wrongly **`item_bom_lines` "built from
   LP-050"** — and LP-050 "Guide Shoe Housing" is a **trade phantom** (made by an unrelated
   cover-plate program). The make-plan explodes SA-DC-078 → LP-050, sees a trade-only leaf,
   marks it `no-make`, and **drops it**. Its **7 real CNC programs cut it directly from 3 mm
   steel** (RM-006/RM-007). **FIX (owner asked to confirm, never answered — confirm then do):**
   delete the one `item_bom_lines` row `(parent=SA-DC-078, child=LP-050)` so the shoe is made
   by its programs; then empty-commit to wipe cache. Verify it then appears under Programs-to-run.
2. **Weekly-plan UI redesign needs the owner's eyes.** Shipped but unverifiable by me — ask
   the owner to review deployed Make + Trade weekly and request tweaks. **Sticky week banners
   were deliberately NOT built** (translucent-bg bleed risk I couldn't verify) — add only after
   visual confirmation. See [[project_weekly_mrp]] for the locked "count not summed-qty" rule.
3. Rule-children **SA-DC-021/024/026/231** (Machine Beam Plates) have **no audited program** —
   they have demand but can't be made; the weekly "Can't make" list was removed at owner's
   request, so this gap is now invisible there. They need programs defined eventually.

## What shipped this session — all LIVE on main (tsc + build green each)

1. **Cabin "create all finish variants"** — toggle on the cabin Add-item modal blows a base
   panel name into all 28 finishes at once (`createCabinPanelVariants` in cabin.ts). Soft-
   deleted the stray bare "P2C 350 WITH TOUCH COP STD" (on a cabin job, so hidden not deleted).
2. **MRP split into two sidebar sections** — **Make MRP** (`/mrp`: Requirements · Programs to
   run · Weekly) and **Trade MRP** (`/mrp/trade`: Requirements · **Buy list** · Weekly). Owner
   rule: **Make = manufacture, Trade = buy**. The **Buy list (sheets/plates) MOVED to Trade**
   (`/mrp/plan` → `/mrp/trade/buy`, old path 302-redirects); weekly sheets moved to a Trade-
   weekly tab. Section-aware `MrpToolbar` + `MrpClient`/`ProductionPlanClient` `section` prop.
   See [[project_mrp_make_trade_split]].
3. **Component-demand rules now drive production, not just the MRP table.** `item_demand_rules`
   (child needed N per demanded parent, e.g. guide shoes per safety frame) were folded into
   demand ONLY in getMrpData's `includeDerivedTrade` path; the make-plan + weekly read demand
   with that flag OFF and never saw them. Fix: `addComponentRuleDemand` now runs on **every**
   demand pass (mrp.ts), and `loadWeeklyDemand` replicates it per-week. Uses the parent's
   **total requirement × qty** (owner: NOT shortfall). No double-count (these aren't
   item_bom_lines). Verifier `scripts/verify-component-demand.ts` updated + green. See
   [[project_component_demand_rules]].
4. **Weekly plan — category grouping + thickness filter + big UI redesign.** Items grouped by
   top-level category, programs by produced-part category. Per-week **sheet-thickness filter**
   on Make Programs (`?thick=`). Then a full redesign (owner called the first cut "pathetic"):
   urgency-weighted week heat-strip, urgency-banded week banners (Overdue + PAST DUE pill),
   `QtyCell`/`MiniChip`/`CategoryTable(showHead)` in weekly-board.tsx, **item lanes headline
   COUNT of distinct items not summed qty**, "Sheets to cut" per-thickness summary on Programs,
   removed the "Can't make" list. Signed off via a `visualize` mockup. See [[project_weekly_mrp]].
5. **Daily Program Runs** — trimmed `operation_runs` to the **June 12** entries only (per owner)
   and removed the plan-derived **"Planned this week" auto-suggest** (page is a pure manual
   logbook now).
6. **Machine-beam Excel export** — `scripts/export-machine-beams.js` → `Desktop\Machine-Beam-Items.xlsx` (47 items). Re-runnable.

---

# Session Handoff — 2026-06-14 (session B · UI refactor + procurement + data)

> For the next Claude session. Read **CLAUDE.md** (deep technical reference) and
> **AI-JOB-BUILDER-PROGRAM.md** (the AI Job Builder SSOT) first; this file is the
> *what-just-happened + what's-open* picture. Newest session on top; earlier
> handoffs (06-14 session A, 06-11 → 06-13) preserved below — still-valid context.

## What shipped this session — all LIVE on main, verified (tsc + build green)

1. **Whole-app compact/professional UI refactor** (owner brief: "professional,
   clean, COMPACT" without losing any functionality/data/mappings). Audit-first
   via parallel agent workflows; every flip adversarially verified against a
   per-area preserve-list. **Presentation only — no locked logic touched**
   (make-plan optimiser, dispatch≠inventory, name=lookup_key, weekly Σruns proof,
   seedRow useMemo, cabin auto-cover, save semantics — all byte-identical).
   - New primitives in `src/components/ui/`: `PageHeader`, `Toolbar`/`ToolbarSpacer`,
     `Tabs` (segmented + underline), `StatStrip`/`StatTile` (tone ok/warn/danger),
     `EmptyState`, `Card`/`CardBody`/`SectionHeader`. Enhanced: `Input`/`Select`
     `size="sm"`, `Table` `density="comfortable|compact|dense"` (context) + sticky
     header, `Modal` `size`. Inter wired to `--font-sans`. Sidebar grouped
     (Inventory / Production / Orders / Planning), w-56.
   - **Every list uses `density="dense"`** (~26px rows) — the owner kept asking for
     tighter; dense is now the standard. New lists should match.
   - Job detail: dead progress bar → REAL shipped %; 18-field meta grid collapses
     blank legacy columns; per-job stock readiness (in-stock vs required by phase).

2. **Procurement** (`/procurement`, `lib/actions/procurement.ts` + `po-outstanding.ts`).
   New tables `purchase_orders` / `purchase_order_lines` (migrations
   `add_purchase_orders` + `po_line_description`). Three views (Tabs): **Orders /
   By item / By supplier** (`getProcurementData`, tag `purchase-orders`). PO# column
   on Orders. "Generate draft POs from Trade shortfall" (orders the net `to_buy`).
   Receiving posts inventory via `recordTransaction(purchase_in)` into MAIN_STORE —
   the one stock writer, idempotent, honours dispatch≠inventory.

3. **Outstanding POs net into MRP.** `MrpRow` gained `on_order` + `to_buy`
   (= max(0, shortfall − on_order)); shortfall/demand UNCHANGED. **Owner rule: a
   shortfall item STILL shows even when a PO fully covers it** (flagged "on order",
   To-buy 0) — never filtered. `getMrpData` tags += `purchase-orders`. Weekly trade
   lane time-phases POs by `expected_date` (`cumulativeShortfall` nets on-order by
   arrival week; no date → arrives now). Optimiser / Σruns untouched (make has no
   POs → provable no-op).

4. **Machine-load tab** on `/mrp/weekly` (per-machine×week planned hours vs editable
   capacity in localStorage; read-only on the locked plan). **Plan-vs-actual** on
   `/program-runs` (this week's planned runs vs logged-today + one-click Log).

5. **Perf wins** (merged `feature/perf-wins`). **THE bug:** `getMakeProductionPlan`/
   `getProductionPlan` called the CACHED `getMrpData`/`getItemsWithStock` *inside*
   their own `unstable_cache` → Next degrades the OUTER cache to pass-through → the
   optimiser re-ran ~5-6s every load. Fixed via un-nested `_getMrpDataUncached` /
   `_getItemsWithStockUncached`. **LESSON: never call a cached read inside another
   `unstable_cache`.** Also cached `getJobDispatchSummary`, `getJobsDispatchStatus`
   (`/jobs` now ISR), `getStockForItems`. Measured live: make-plan warm 5-6s → ~2.2s.
   **REGION MOVE (Netlify us-east-2 → Mumbai) is STILL the #1 perf fix** — excluded
   on purpose (owner one-click; ~270 ms/query saved; see the perf deep-dive below).

6. **Data loaded** (via PostgREST REST + anon key, **matched ONLY by item `code`**):
   - Suppliers on **1,030 active trade items**.
   - **33 open POs / 80 lines** (status `ordered`, source descriptions preserved).
   - **57 no-category phantom parts** → set `stock_behaviour='phantom'` + AI-mapped
     to existing categories (adversarial verify; every path validated against the
     live taxonomy). 4 wrongly-STOCKED parts now phantom (LP-076, SA-003, SA-004,
     SA-005). Owner reviewed the Swing Door ones → LP-024/LP-025 moved to
     `Swing Door › Swing Door`; LP-021 kept in `Swing Door › Swing Door Cover`.
     Result sheet: `Downloads/Phantom Parts - Category Assigned 14.06.2026.xlsx`.

## Open items / next-session candidates

- **★ Weekly week-labels (owner asked at end of session, NOT yet built):** replace
  the "This week / Next week / In N weeks" wording with **actual date ranges**, and
  switch weeks to **Sunday–Saturday** (currently Monday-start). Target labels like
  **"14–20 Jun"** (Sun→Sat). Touch points: `buildWeeks` in `lib/actions/mrp-weekly.ts`
  (week start → Sunday), the `WeekMeta` label/title, the weekly board
  (`weekly-board.tsx` / `weekly-mrp-client.tsx`), and `curWeek` wherever program-runs
  plan-vs-actual / weekly capacity compute "this week". **CAREFUL:** moving the week
  boundary re-buckets which jobs/POs land in which week — re-verify the Σruns/
  allocation proof still holds (it should; only bucket edges move, the optimiser
  still runs once on the full horizon). Keep the "Overdue" lane. Labelling +
  bucketing change only — do NOT touch the locked optimiser.
- **4 belt-component items** `FG-GR-066/067/068/069` to create + add to PO
  `LTE/PO/26-27/098` (owner has the list; skipped because not yet in inventory).
- **Expected dates on POs**: owner to enter per PO (editable on PO detail) so the
  weekly trade time-phasing is precise; until then on-order = arrives now.
- **No-link queue**: 2 exports in Downloads (`Trade Items - No Link` 436 +
  `Make Items - No Link` 132) for the owner to link/categorize. The 57 phantom just
  done shrank it; many now classify as Jobs/Formula.
- **Wave 1d polish (deferred, low priority):** remaining `window.confirm/alert` →
  `ConfirmDialog`/`useToast`.
- **Data-dependent no-ops (need owner data first):** below-reorder filter/sort +
  reorder-point replenishment POs, lead-time "order by" — all need
  `reorder_point`/`lead_time_days` populated (currently ~0).

## Working agreements (this session)

- **Verify on the LIVE deploy** — OneDrive makes local dev/`unstable_cache` flaky.
- **Out-of-band DB writes (REST/SQL) need an empty commit** to wipe app caches.
- **Match imports by CODE, never name.** Preview/count before bulk writes.
- Scratch scripts live in the session temp `tasks/` dir (recon / import / export /
  categorize). Branches `feature/erp-refactor` + `feature/planning-features` +
  `feature/perf-wins` preserved for revert.

---

# (Earlier · 2026-06-14 session A) Weekly MRP + AI/dispatch — SHIPPED, LIVE on main, verified

1. **Weekly MRP plan** (`/mrp/weekly`) — the headline. MRP broken into an Overdue
   lane + the next 8 Monday-start weeks, sub-tabs **Make / Trade / Programs to run /
   Buy list**, mirroring the Job Orders Dispatch Plan board. **The owner's rule,
   honoured:** never optimise each week separately (it over-provisions) — the
   owner-tuned sheet-minimiser runs ONCE on the full 8-week demand, then those
   globally-minimal runs are ALLOCATED to weeks by deadline (Σ weekly runs === the
   one optimum, zero over-provisioning; proven on-screen + by the verifier). One
   optimiser pass + in-memory bucketing → no slowdown.
   - NEW `src/lib/actions/make-plan-core.ts` — the optimiser core + reusable
     `explodeToLeaves`, EXTRACTED from production-plan.ts so make-plan AND weekly
     drive the EXACT same selection (make-plan output byte-identical post-extraction,
     verified by a before/after diff). **Don't duplicate the optimiser — extend the core.**
   - NEW `src/lib/actions/mrp-weekly.ts` (`getWeeklyMrpPlan`, `loadWeeklyDemand`, the
     run allocator). NEW `weekly-board.tsx` + `weekly-mrp-client.tsx`; `/mrp/weekly`
     route + loading skeleton; "Weekly plan" added to `mrp-toolbar.tsx`. Existing MRP
     views untouched. `mrp.ts` exports `_getMrpDataUncached` (for the verifier).
   - Scope = strictly 8 weeks (jobs due later / no date excluded → muted count).
     Buy list = raw SHEETS for the programs (trade-leaves-under-make deferred —
     sub-assemblies are sparse). Memory: `project_weekly_mrp.md`.

2. **AI Job Builder — Pass 2** (predictor accuracy). Encoded the SAFE deterministic
   quantity rules into `predict-core.ts` (`deterministicQty`), ONE at a time,
   backtest-gated: **KEPT** A limit-switch set = 6 (fixed a floor-scaling bug), B
   landing-side = L, C1 sill-angle = L, D the 7 always-1 car/machine sections.
   **REJECTED** C2 aluminium-sill = L+1 (regressed — stored sill too noisy; comment
   in code says don't re-try). E never-present-suppression unnecessary. Keep-rate
   71.7→72.0, qty±10% 85.5→85.9, no drive regressed. AI-JOB-BUILDER-PROGRAM.md updated
   with the PASS 2 record; **next lever = NAME COMPOSITION** (attacks item-hit 84%,
   the bigger ceiling). Corpus survey: every drawing already read — under-covered
   types (HYD n=2) are data-limited, not reading-limited.

3. **AI Auto-Fill robustness.** (a) A real crash on job 4938 — vision *succeeded* but
   the flow hit the route error boundary ("Something went wrong"); wrapped
   `autofillFromDrawing` (returns the message), caught in `runAutofill` (toast), and
   guarded `ConfidenceBadge` — can never blank-crash again. (b) Slow *merged multi-sheet*
   PDF reads were 502-ing (serverless function timeout) — bounded the vision fetch with
   a 22 s AbortController (`VISION_TIMEOUT_MS` in spec-vision.ts); a slow read falls back
   to the typed-spec BOM + a review-modal note. **Proper fix if slow reads recur = move
   the drawing-read to a Netlify BACKGROUND function (15-min limit) + client poll** —
   deferred. `ANTHROPIC_API_KEY` is live; vision works.

4. **Job Orders "Fully Dispatched" tab.** A job leaves "Active" only when every BOM
   line is fully dispatched (`getJobsDispatchStatus === "full"`). URL-backed tabs.

5. **Dispatch-status accuracy fix.** `getJobsDispatchStatus` read `job_bom_lines` /
   `job_dispatch_lines` WITHOUT pagination → over the 1000-row PostgREST cap → some jobs
   mis-flagged "Fully Dispatched" (non-deterministically). Now pages via `fetchAllRanged`
   + stable `.order("id")`. Verified: 16 truly-full jobs, deterministic.

## Open items from this session (next-session candidates)
- **Weekly MRP polish** (likely after the owner uses it): a cumulative-by-week toggle
  vs the current incremental "+N (cum M)"; group programs by machine; a "Don't run"
  exclude on the weekly board (the `?exclude=` plumbing is already wired through to the
  optimiser); buy list could add trade-leaves-under-make if sub-assemblies grow.
- **AI predictor — name composition** (AI-JOB-BUILDER-PROGRAM.md checklist #1): compose
  the right SKU name from spec + resolve to an item_id when no neighbour carries it.
  Highest remaining accuracy lever; needs an item-resolution step + a smarter backtest.
- **AI re-derivation drift-flag** (offered, not built): a cheap nightly check that pings
  when ~15–20 new audited jobs accumulate → prompt a manual rule-encoding pass. Do NOT
  auto-cron the re-derivation itself (overfits on small data).

## Verify / continue
- `npx tsc --noEmit` (clean) · `npm run build` (passes).
- `npx tsx scripts/verify-weekly-mrp.ts` (weekly engine — all green) ·
  `npx tsx scripts/backtest-bom-predict.ts` (predictor — 72.0% keep-rate).
- `unstable_cache` can't run under tsx (needs Next's incremental cache) — inject
  uncached MRP (`_getMrpDataUncached`) into `computeMakePlanCore`, or capture make-plan
  baselines via a temporary uncached `/api/...` route on the dev server.
- OneDrive makes local dev/preview flaky (constant Fast-Refresh churn resets client
  state mid-test) — verify on the LIVE deploy.

---

# (Earlier) Session Handoff — 2026-06-11 → 06-13

> Still-valid context from prior sessions.

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

## AI Auto-fill (2026-06-13) — SHIPPED, additive, flywheel live

Upload a drawing → "AI Auto-fill" on the job edit form → review a pre-filled
draft (spec + BOM) with per-line confidence + provenance → edit → Save. Engineer
audits instead of types. **Additive only** — applies through the EXISTING picker
via the same path as "Import from Job"; locked createJob/updateJob/saveBomSection
untouched; capture-on-save is void+catch (never blocks a save). Branch
`feature/ai-autofill` merged to main (05c89fe + d9b02f2).
- **Two stages:** (1) drawing→spec = Claude vision, `lib/actions/spec-vision.ts`,
  raw fetch (no SDK dep), reads `ANTHROPIC_API_KEY`; absent → graceful "not
  configured" and the feature still works from the typed spec. (2) spec→BOM =
  pure k-NN retrieval, `lib/bom/predict-core.ts` + `actions/bom-predict.ts`,
  label-noise aware (learns section presence only from RAIL-complete jobs),
  gate-correct, floor-scaled qty, per-line confidence. excludeJobId drops the
  edited job from its own corpus (verified live — was self-matching BBSR-314).
- **PROVEN accuracy** (leave-one-out, same core, `scripts/backtest-bom-predict.ts`,
  no key): section F1 0.95, item-hit 84%, qty-within-10% 85%, **BOM keep-rate
  71%** vs 56% gate-only baseline. Verified the live UI no-key flow end-to-end
  (63 lines suggested, 42 pre-checked, apply fills picker, "Unsaved" pill).
- **Flywheel (migrations 021/022, LIVE):** `jobs.bom_completeness` (RAIL rule,
  gate-correct: 86 complete / 42 partial — HYD jobs correctly complete);
  `job_field_suggestions` logs suggestion-vs-saved per field; `ai_accuracy_snapshots`
  + `nightly_ai_maintenance()` on **pg_cron 01:00 IST** re-tags labels + records
  keep-rate. Retrieval reads live audited jobs each call → pool grows with zero
  retrain. Caveat: rubber-stamping (applying without correcting) would let it
  learn from its own output — keep the engineer genuinely auditing.
- **OWNER ACTION to switch on drawing-reading:** add env var
  `ANTHROPIC_API_KEY` in Netlify (Site config → Environment variables) → redeploy.
  Verify with one drawing together — vision is the ONE piece untested without a key.
- **OPEN follow-ups:** a visible keep-rate dashboard (data accrues now, no UI yet);
  goods-vs-passenger already hard-partitioned in similarity; validate the exact
  Claude vision request shape (model id, document block) on the first keyed run.
- **DEEP-STUDY PROGRAM (owner "god mode", 99% over months).** Phase 1 shipped: RICH
  full-drawing extraction (drive/floors/capacity/door/finish/brand + 11 dims + ~49
  details per drawing) stored in `job_drawing_extractions` (migration 023) on every
  autofill, with discrepancy detection — verified live (BBSR-314). Existing drawings
  studied via PARALLEL AGENTS reading PDFs (Read-tool vision, zero API cost).
  **Batch-1 (18 jobs, all drive types) → `AI-DRAWING-STUDY-BATCH1.md`.** VERIFIED
  rules-to-revisit needing OWNER decisions: (1) ~~`jobs.floors` off-by-one~~ RESOLVED
  2026-06-13 (owner): `floors` is now TOTAL STOPS. Form dropdown changed G+N → plain
  Stops (1,2,3…), all 132 jobs migrated +1 (migration 024), spec_string → "N Stops/…",
  detail label "Stops", importer +1. Fixes the AI floor-scaling at the source (floors=stops
  everywhere, no predict-core change needed). Live MRP was already safe;
  (2) `drive_type` overloaded (topology×suspension×frame — BELT=MRL+belt, CANTI=frame,
  an "MR" is really MRL) → consider splitting, BOM tokens are ground truth; (3) capacity
  wrong-class (5001 "6PASS"=4000KG goods; 4847 "6PASS"=16-pass) → cross-check Machine
  Unit token + goods flag; (4) rope/belt qty are METRES not pieces; (5) ~5 partial BOMs.
  Strongest pattern: landing qty = stop count (~15/18). Next batches: fix the workflow
  to also STORE the stage-1 rich extractions (pipeline returned only the map stage).

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
