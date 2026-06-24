# BOM Predictor — Handoff

Branch: `feature/bom-predict-drive-aware` (local, 40+ commits, not yet merged/pushed).

## What it is
Upload a GA drawing → vision reads the spec → predictor drafts the full job BOM (inventory-linked).
k-NN over past jobs + section-wise consensus + multi-attribute SKU composition + engineering rules.

## Accuracy (leave-one-out backtest, `scripts/_section_eval.ts`; realistic metric:
## `--real --forgivefp --qtol=0.2 --materialtouch`)
SHIPPED behaviour — these sections are in `SUPPRESS_PREDICTION` = left for MANUAL fill (the
genuinely-undrawable ones; a clean blank beats a confident-wrong prefill): **Cabin Glass,
Pulley Main, Pulley Counter, Filler Weight, MAIN BRACKET, COUNTER BRACKET**. The eval excludes
them from the score (they're manual).

| On the AUTO-FILLED BOM | Realistic | Strict (qtol=0.1) |
|---|---|---|
| Coverage (right item pre-filled) | 93% | 93% |
| **Auto-fills perfectly (item + qty)** | **91%** | ~83% |
| Need an edit | **9%** | ~17% |

Why each suppressed section can't be nailed: Pulley C.I./PVC = coin-flip (not drawn); Filler
exact COUNT = needs undrawn counter-frame height (TYPE is solved); Cabin Glass = unpredictable;
rail brackets = standard B/C/F is a per-rail projection read off one ambiguous gap (~45%) and
the combination's X-projection isn't a drawn dim (the family/class ARE right — re-enable by
removing them from SUPPRESS_PREDICTION if you'd rather a fix-one-token prefill, ~89%).

CAVEAT: the backtest feeds the carefully re-read corpus extractions. A LIVE upload uses a single-pass vision read (`spec-vision.ts`), which is coarser — expect a few points below the backtest on a real drawing. Unusual drives (R1000, hydraulic) are far weaker (the predictor warns to build by hand).

## Code map
- `src/lib/bom/predict-core.ts` — THE engine (pure fns; live + backtest share it). Tunables in `TUNING`, attributes in `ATTRS`, the `COMPOSE` map, `fillerTypeFactor`, `bracketLevels`, `bracketProjFactor`, `dbgDistance`.
- `src/lib/actions/bom-predict.ts` — live action + the catalogue pool.
- `src/lib/actions/spec-vision.ts` — the drawing → spec vision schema/prompt (the LIVE read).
- `src/lib/actions/job-autofill.ts` — wires vision spec → predictor target.
- `scripts/_section_eval.ts` — the backtest harness (flags: `--real --forgivefp --materialtouch --qtol --exclude --skipdrive`).
- `scripts/partlist-brain/data/drawing-extractions.json` — the corpus extraction (door finishes, rail gaps, spacing, optical-combination — all re-read this session).

## Domain rules encoded (owner's knowledge)
- Car door finish MUST match the drawing (designer colour); landing finish is the engineer's judgement.
- Combination main bracket = OPTICAL (counterweight-at-side) + counter DBG.
- Filler weight = capacity→total mass; AHM (cheap/light) maxed to frame height, CI/Plate (dense) tops up.
- Door-post / linton / landing-panel take the LANDING door colour; headers/sill plain.
- Per-landing parts scale with STOPS; per-shaft consumables with TRAVEL not floors.
- Pulley material decided by similar jobs; safety frame from drive + 2:1-roping pulley.

## The irreducible floor — do NOT re-attack (the drawing doesn't carry it)
- MAIN BRACKET combination X-projection (X180/X260) — not a drawn dimension; per-position B/C counts vary.
- Pulley C.I./PVC — coin-flip, absent from the drawing.
- Filler exact COUNT — needs the counter-frame HEIGHT (undrawn). The TYPE is solved.
- BRICK (needs wall-type read), Cabin Glass (unpredictable), door granularity (Linen-vs-Hairline, telescopic LHS/RHS).

## Re-running the extraction (when new jobs land)
- Render: `node scripts/_render_plan.js <url> <jobnum>` + `node scripts/_crop.js <src> x y w h <out>` (node-canvas; no poppler).
- Background-vision Workflows STALL — use parallel Agent-tool readers in ~15-job slices (`scripts/_bracket_slice0..5.json`); merge via `_merge_doorfinish.js` / `_merge_brk2.js`.

## Highest-value next work (NOT more prediction)
- Surface these reads in the live `/jobs/new` autofill UI (let the engineer see + accept).
- POs / work-orders downstream of the predicted BOM.
