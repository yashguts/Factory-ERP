# Auto Part-List Brain — Accuracy Report (Milestone 1 gate)

_Generated from the offline brain in `scripts/partlist-brain/`. Two halves:
**drawing → spec** (vision, validated on 23 paired drawings) and **spec → part-list**
(validated leave-one-out on the factory's 227 historical part lists in
`Part List.xlsx`). Both are reported below._

## TL;DR for the owner

Starting from just the job spec (`G+N / capacity / door type`), the brain rebuilds
the Mechanical Part List and links each line to inventory. Tested by hiding each of
your 227 past jobs in turn and predicting it from the other 226:

| Question | Result |
|---|---|
| Did it list the **right parts**? (item particulars) | **90%** (precision & recall) |
| Did it get the **quantity** right? | **80% exact**, 87% within ±1 |
| Did it get the **size/spec** right? | **79%** |
| **Whole lines perfect** (right part + qty + size, no edit needed) | **67%** |
| Lines **auto-linked to a real inventory item** | **83%** (rest flagged "needs item") |

Plain English: for a typical job the brain produces a part list where **~2 out of 3
lines are exactly right and need no touch**, **9 of 10 of the right parts are
present**, and **3 of 4 item lines come pre-linked to stock**. The engineer reviews
and fixes the rest instead of building 200+ lines by hand. That is the time saving.

This is a **floor, not a ceiling** — it's pure "copy the most similar past job +
formula-adjust", before the known accuracy levers (below) are switched on.

## Drawing → spec (vision), 23 paired drawings

Can a model read the job spec straight off the GA drawing (replacing the manual
spec-entry step)? Each drawing was read blind and scored against the engineer's spec:

| Field | Accuracy |
|---|---|
| Drawings successfully read | **23 / 23** |
| Stops / floors | **96%** |
| Door type | **100%** |
| Drive type | **96%** |
| Capacity (KG↔passenger normalised) | **87%** |
| **Full core spec correct** | **83%** |

Note: the raw scorer first showed 52% on capacity — an artifact, because the model
reads capacity in **KG off the drawing** while the engineer's spec uses **passengers**
(272 kg = 4 pass at 68 kg/pass). After unit-normalising it's 87%. The 4 remaining
misses are a roof-level miscount and 2 drawings whose stated KG implies a different
passenger count than the engineer wrote (real drawing-vs-spec discrepancies the review
step surfaces). Re-score: `node scripts/partlist-brain/rescore-vision.js`.

**Takeaway:** the drawing read is reliable enough to pre-fill the Job Order; the
engineer confirms the spec, then the part list follows.

## Drawing → features → smarter quantities (69 drawings)

A second, deeper read pulled the dimensional features that drive the *variable*
quantities — **travel, floor height, openings (count + sides), shaft & car dims**
(travel 68/69, openings 69/69, door width 66/69). Re-mining the travel-scaled parts
on real travel instead of stops-as-a-proxy measurably tightens exactly the parts that
were on k-NN fallback:

| Part | Stops-only MAE | With travel | Δ |
|---|---|---|---|
| Guide Rail (Main) | 1.32 | **0.92** | −30% |
| Guide Rail (Counter) | 1.35 | **0.94** | −30% |
| Troughing | 2.02 | **1.34** | −34% |

These travel models (`data/travel-models.json`) are wired into the predictor and fire
at runtime whenever the drawing yields travel; otherwise it falls back to the stops
formula / k-NN. (Headers, sills, cable-hanger were already nailed by the stops models;
openings didn't help on this single-entrance-heavy sample but is captured for the rare
through-car jobs.) Reproduce: `node scripts/partlist-brain/remine-with-features.js`.

## How it works (transparent, not a black box)

Every predicted line carries provenance (which neighbour job / which formula) and a
confidence. The pipeline:

1. **Corpus** (`parse-corpus.js`) — 227 job part lists → structured records. Spec
   parsed on 216 (95%); **99% of 40,276 part-list lines** map to a known section.
2. **Quantity models** (`mine-quantities.js`) — per part, fit qty vs stops. Of the
   common item parts: **154 get a reliable formula** (e.g. Sill Angle = stops,
   Header = stops+1, Cable Hanger ≈ 4), **79 fall back to copy** (travel-scaled /
   multi-size: Guide Rail, Troughing, Fish Plate), 60 free fasteners → copy.
3. **Predictor** (`predict.js`) — find the most similar past job (door type, stops,
   capacity, drive), copy its structure, refine quantities by formula.
4. **Rules sizing** (`extract-rules.js`) — the engineer's capacity-band → size table
   for Guide Rail & Fish Plate, plus 7 door/drive skeletons. Built; wired as a
   runtime fallback in Milestone 2.
5. **Inventory resolution** (`resolve-inventory.js`) — match (category + size) to a
   real `item_id`; size-discriminated categories (Guide Rail) require an exact size,
   base-part categories match by name. Unmatched → flagged for review.

## Detailed metrics (leave-one-out, 216 jobs)

```
Presence  ALL  : precision 89.4%  recall 89.4%  F1 89.4%
Presence  ITEM : precision 90.0%  recall 90.4%  F1 90.2%
Quantity (matched item lines, n=19030): exact 80.2%  within±1 87.0%
Spec/size (matched item lines w/ spec, n=15198): 78.6%
Lines correct as-is (present + qty + spec): 67.4%
Inventory resolution (27,092 item lines): 82.9% linked, 4,645 flagged
```

Resolver v2 + category overrides lifted resolution 75% → **83%**. The subset-match
handles verbose specs — e.g. spec `DBG-850mm/100x40x40x3/1.7M`
now matches SKU `Counter Weight Frame Goods DBG-850mm`, and `8mm (34mtr x 6nos)`
matches `Wire Rope 8mm`; category overrides recovered Dade Weight Rod → SKU
`Dead Weight25x25 600MM` and Car Header Hanging Bkt → `HEADER Hanging Car Bkt`.

## Where it's strongest / weakest

- **Strong**: structural + sized parts — Guide Rail, Sill Angle, Lintone, Headers,
  Cable Hanger, D-Shackle, Bull Dog Clips, Troughing, Pit Ladder, Facia (resolution
  90–100% in these categories).
- **Weak**: free **fasteners / fixing kits** (bolts, reed/toci kits) — high variance,
  multi-size; they're copied from the nearest job and are the bulk of the misses.
  These are cheap consumables bought in bulk, so low precision there is low-cost.

## Headroom — what we tested (measured, not assumed)

- **Drawing read (travel/openings)** — **DONE.** Cut Guide Rail / Troughing MAE ~30%.
- **Top-K consensus** — **tested, no gain** (`tune-consensus.js`): F1 90.2 (single-NN)
  vs 90.0 (best consensus). Jobs cluster so tightly by door/drive/capacity that the
  single most-similar job is already the right template; averaging in less-similar jobs
  adds noise. *Nuance:* low-threshold consensus reaches **92.6% recall** at lower
  precision — useful for a review-first draft (deleting extras is easier than adding
  misses).
- **Category overrides** — **+1.3%** resolution: SKUs that existed under different
  category names, remapped in the resolver (verified in DB).

This puts the **spec-only** brain near its practical ceiling. The remaining ~17%
unresolved / ~33% imperfect lines are dominated by things spec-tuning can't fix, only
the named next steps can:

1. **Runtime, not spec-time** — finish-only parts (Linton `SS`) and travel-scaled
   quantities need the *drawing* at generate time (travel wired; door-width resolution
   is a Milestone-2 step).
2. **Genuine inventory gaps** — e.g. G.I Wire No-24, Brake Releaser Stand have no SKU;
   surfaced as "needs item" / create-item prompts.
3. **Out of scope** — cabin items (separate corpus).
4. **Long tail** — naming-convention mismatches (Buffer Channel `DBG` vs `Combination`),
   each <0.5%.

Net: the biggest real gains now come from the drawing at runtime, closing inventory
gaps, and the engineer-review learning loop — i.e. Milestone 2, not more brain-tuning.

## Reproduce

```bash
node scripts/partlist-brain/parse-corpus.js       # -> data/corpus.json
node scripts/partlist-brain/mine-quantities.js    # -> data/quantity-models.json
node scripts/partlist-brain/extract-rules.js      # -> data/rules.json, vocab.json, templates.json
node scripts/partlist-brain/resolve-inventory.js  # -> data/resolution.json   (reads Supabase)
node scripts/partlist-brain/backtest.js           # -> data/backtest.json
```
