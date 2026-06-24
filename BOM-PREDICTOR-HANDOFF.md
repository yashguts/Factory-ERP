# BOM Predictor — Handoff (for a deep, fresh session)

**Goal (owner):** a button on the Job Orders page — upload a GA drawing → the system
fills the entire Mechanical BOM, every line linked to a real inventory SKU, the way an
engineer does it from the same drawing. Target accuracy **95%+, ideally near-100%**.
Owner's thesis (correct): *the information to reproduce the BOM is on the drawing — the
engineer uses nothing else — so it's a careful read + mapping problem, not a guess.*

Branch: **`feature/bom-predict-drive-aware`** (13 commits, NOT merged — owner reviews the
deployed app, not code). Everything below is committed there. The repo also has the older
`SESSION-HANDOFF.md` (Part-List feature) and the auto-memory `project_ai_autofill.md`
(densest running log of this exact work — read it).

---

## 1. Where accuracy stands (leave-one-out, the honest numbers)

Two evals — keep BOTH green when you change `predict-core.ts`:

| Eval | What it is | keep-rate | item-hit |
|---|---|---|---|
| **Backtest** `scripts/backtest-bom-predict.ts` | item-derived target (no drawing); the **no-regression gate** | **75.4%** | 88.8% |
| **Realistic** `scripts/_rich_eval.ts` | target attrs come FROM the cached drawing reads (what production does) | **75.4%** | **89.3%** |

Session start was 69.8% keep / 82.8% item. Per-section item-hit now (realistic eval):

```
Door Sill 89 (qty 74) · Car Header 88 · Landing Header 88 · Machine 85 · Filler 81 ·
Counter Frame 78 · Safety 73 · Linton 68 · Car Door Panel 67 · Landing Door Panel 60 ·
Door Post 57
```

`keep-rate` needs item AND qty right. qty is ~90%+ except Door Sill (data noise) and the
door panels.

---

## 2. How the engine works (`src/lib/bom/predict-core.ts`, PURE — no DB/LLM)

Two layers, run by `predictFromCorpus(target, corpus, inventory?)`:

1. **Retrieval (k-NN)** — pick the most similar past jobs by `similarity()` (drive type +
   DOOR TYPE + capacity + floors), aggregate their sections/items/quantities. This decides
   PRESENCE (which sections) and is the fallback for items.
   - Drive model: `DRIVE_PRIOR` (structural, all 8 codes incl. MRL Belt + R1000). `TUNING`
     has the weights (drive 0.42 / door 0.18 …), `SIM_SHARPEN` 4, `TARGET_K` 6.
2. **Composition (the new core)** — for size-keyed sections the SKU NAME encodes the
   drawing's attributes, so we compose it directly:
   - `COMPOSE` maps each section → its attribute list. `ATTRS` defines, per attribute, how
     to DERIVE it from the target and how to MATCH it in a SKU name:
     - Car/Landing Door Panel: `doorType, material, vision, width, colour, side, channels`
     - Door Sill / Headers: `doorType, width(, side)`
     - Door Post: `doorType, material, colour, side` (NO width — its SKU has none)
     - Safety: `frameType, dbgCar` · Counter Frame/Guard/Filler/Machine Beam: `frameType, dbgCtr`
   - `composeScore` scores every SKU in the **section pool** by weighted attribute match;
     the best (gated by `COMPOSE_MIN_FRAC`/`COMPOSE_MIN_SCORE`) is injected with dominant
     weight. The pool = past-used SKUs (`buildSectionPool`) PLUS the **full inventory
     catalogue** (`InventoryPool`) so an exact colour×width combo resolves even if no past
     job used it.
   - Quantities: `deterministicQty` (landing parts = stops; singletons = 1; aluminium sill
     = stops+1; limit switch = 6; etc.). Everything else floor-scaled/median from retrieval.
   - **Only assert an attribute when READ, never guessed** (vision is left null when the
     spec is silent) — so composition never overrides retrieval on a guess.

Wiring: `src/lib/actions/bom-predict.ts` (`getTrainingCorpus` + `getDoorInventory` → cached
reads, passed to `predictFromCorpus`). `src/lib/actions/job-autofill.ts` threads the drawing
read into the target. `src/lib/actions/spec-vision.ts` = the live Claude-vision drawing read.

---

## 3. ⚠️ The biggest gap: eval ≫ production (READ THIS)

The eval numbers assume the drawing is read with ALL attributes. The **live** read
(`spec-vision.ts`) currently extracts only: drive, floors, capacity, door_type,
door_finish, **door_opening_width** (added). It does **NOT** yet extract:

- `door_vision` (LV/MV/NV) and `operator_side` (LHS/RHS) — the VISUAL door attributes
- `dbg_main_mm` / `dbg_counter_mm` — the two guide-rail spacings (car vs counter)

So on a brand-new job, the composer's vision/side/DBG attributes are null → Headers, Safety,
Counter, and the door-panel vision gains **do not happen live yet**. **First priority for
"building it entirely": upgrade `spec-vision.ts`'s schema + prompt to extract these** (vision
glass from the door elevation, operator side from the plan, both DBGs from the plan — these
are PICTURES, read them visually). Then the production button matches the eval. This is the
single highest-value piece of "make it real."

---

## 4. Data pipeline (regenerate the feature corpus)

All 157 GA drawings are downloaded to `scripts/_drawing_pdfs/<jobId>.pdf` (+ `_jobspecs/<i>.json`,
0–156). Feature corpus is built by these scripts (run in order; they read `.env.local` for the
Supabase anon key and use the multi-agent **Workflow** tool):

1. `_dl_drawings.ts` → downloads PDFs + `_drawing_manifest.json`
2. **exhaustive extraction** (4 parallel slice-Workflows of `_exhaustive_slice.js`, args
   `{start,end}`) → `_merge_features.js` → `scripts/_drawing_features_exhaustive.json`
   (~164 data points/drawing: structural dims + BOM-driver specs + an `all_dimensions` catch-all)
3. `_refine_dims.js` → label-parses precise DBG (inner not outer span; excludes wall/pocket/
   sub-dims) → `scripts/_drawing_features.json` (the WORKING copy all evals read)
4. **visual reads** (4 slice-Workflows of `_doorvis_slice.js`) → `_merge_doorvis.js` adds
   `car_door_vision`/`landing_door_vision`/`operator_side`
5. **two-DBG read** (4 slice-Workflows of `_dbg_slice.js`) → `_merge_dbg.js` overrides DBG
   with the precise car-guide vs counter-guide values. **Only 59/157 done** — the rest were
   transiently rate-limited; RE-RUN/resume to finish all 157 (resume via `{scriptPath,
   resumeFromRunId}` per slice). NOTE: `_merge_dbg.js` task-IDs must match the latest run.

Reverse-engineered SKU rules (16 sections, MEASURED match %): `scripts/_sku_rules.json`
(from a parallel Workflow — `_jobwise.ts`/`_cardoor.ts` are the job-by-job rule finders).
Per-section SKU+feature joins: `scripts/_sections/<Section>.json` (built by `_build_section_data.js`).

---

## 5. Tooling cheat-sheet

- `npx tsx scripts/backtest-bom-predict.ts` — the no-regression gate (run after EVERY change)
- `npx tsx scripts/_rich_eval.ts` — realistic per-section item+qty (NODBG=1/NOSIZE=1 ablations)
- `npx tsx scripts/_jobwise.ts "<Section>" <feature>` — drawing dim next to the actual SKU
- `npx tsx scripts/_mine_signals.ts scripts/_drawing_features.json` — section→dimension miner
- `npx tsx scripts/_cdp_miss.ts` / `_ldp_miss.ts` — per-job truth-vs-pred misses for a section
- `npx tsx scripts/_cardoor.ts "<Section>"` — per-attribute drawing↔SKU agreement
- `npx tsc --noEmit` — must stay clean

---

## 6. The method that works (owner-validated; keep using it)

**Job-by-job → the rule is literally in the SKU name → compose it from the drawing.** Every
big win came from this loop: dump a low-% section's SKUs next to the drawing attributes, see
the failing attribute, fix the derivation/extraction, re-test on the backtest, recurse.

Owner insights that each paid off — internalise them:
- "Door vision & LHS/RHS are PICTURES, not text" → visual reads → Headers 60→88%.
- "Safety and counter DBG are literally different and both shown" → two-DBG read → Safety/Counter up.
- "Check Door Sill qty by door type" → confirmed sill = stops+1, re-tested, +7pt qty.
- "Compose the exact SKU" → full-inventory composition → Car Door Panel 62→67%.

---

## 7. Next levers (prioritized for the deep session)

1. **Live vision schema** (§3) — extract vision/side/both-DBGs/opening-width in `spec-vision.ts`
   so production matches the eval. Highest value.
2. **Finish the two-DBG read** (all 157) → Safety/Counter/Filler/Machine Beam jump together
   (only 59/157 currently).
3. **Door panels → ~72%+** (Car 67, Landing 60). From the miss dumps the residual is:
   - **colour/material** parsed from the WRONG door: when finish lists Car & Landing
     separately (e.g. "Rose Gold (Car); MS RAL-8017 (Landing)"), Landing Door Panel must read
     the LANDING portion. Add `landingFinish` + landing-specific material/colour attrs.
   - **MS vs SS**: several truth `AT/MS` predicted `AT/SS` — `targetMaterial` over-defaults SS.
   - **AFF format**: `AFF SS/1800x2400mm/NV` is a different SKU shape (width×2400) — add it.
   - **Swing door side**: `Swing Door SS/700/LH/LV` carries LH/RH too.
   - **height token**: `…/700/2100` vs `/700/2000` (door height) for some MT/CO panels.
   - colour exactness (Rose Gold vs Golden vs Silver Mirror) is partly the genuine ceiling
     (customer choice not always on the drawing).
4. **Door Post (57%)** — LHS/RHS hand + door-type extraction.
5. **Wire the remaining `_sku_rules.json` sections** into `COMPOSE` (Machine, Governor,
   Wire Rope — Governor model 75%, rope size 77% signals).
6. **Extend `InventoryPool` to all composable sections** (currently door panels only).
7. **Quantity rules** for the count/floor-scaled sections (RAIL, brackets, troughing) — the
   keep-rate gap (item 89 vs keep 75) is mostly qty in the non-watched sections.

---

## 8. Gotchas / hard-won lessons

- **Branch flips:** the working tree landed back on `main` ~3× mid-session ("intentional" per
  the harness). All work is safe on the feature branch; extraction outputs are untracked
  (survive switches). If a script errors `normaliseDoorType is not a function`, you're on main
  → `git checkout feature/bom-predict-drive-aware`.
- **Re-test "rejected" rules:** the aluminium-sill rule was rejected once, works now (cleaner
  corpus). Don't trust old REJECTED notes — re-measure.
- **Exhaustive extraction trades precision for breadth:** the big read made the specific DBG
  field noisier; the targeted DBG read + label-parsing is more accurate. For a key dimension,
  prefer a FOCUSED read/parse over the catch-all.
- **API rate-limits seen were transient** ("Server is temporarily limiting requests, NOT your
  usage limit") — not a weekly cap. Just retry/resume; smaller concurrent fan-out helps.
- **Don't run two 157-agent extractions at once** (overloads → rate-limits).
- **Data noise is real:** some BOM quantities are placeholder `1`s (Door Sill). A rule can't
  fix bad data — gate every rule on the backtest, keep only net-positive ones.
- **It's additive & read-only:** the predictor never writes; it drafts a BOM the engineer
  reviews. Nothing here touches existing job data (owner confirmed this matters).
- `npx tsc --noEmit` is the gate; co-author trailer `Claude Opus 4.8 <noreply@anthropic.com>`.

---

## 9. Suggested first moves in the new session

1. `git checkout feature/bom-predict-drive-aware`; run both evals to confirm the baseline
   (75.4% keep / 89% item).
2. Resume the two-DBG read to 157/157, re-merge, re-measure the frame sections.
3. Upgrade `spec-vision.ts` to extract the visual + DBG attributes (make eval == production).
4. Then grind door panels job-by-job (Landing finish, MS, AFF, swing side) → ~72%+, and keep
   recursing section-by-section with the backtest as the gate.

The whole thing is a compounding loop: read deeper → mine the rule → compose → backtest →
recurse. We're at 89% item-hit; the path to 95%+ is more of exactly this.
