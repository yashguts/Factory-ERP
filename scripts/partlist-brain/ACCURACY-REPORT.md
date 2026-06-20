# Auto Part-List Brain — Accuracy Report (Milestone 1 gate)

_Generated from the offline brain in `scripts/partlist-brain/`. This is the
**spec → part-list** half of the system, validated leave-one-out on the factory's
own 227 historical part lists (`Part List.xlsx`). The **drawing → spec** half
(vision) is reported separately below once the fan-out completes._

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
| Lines **auto-linked to a real inventory item** | **75%** (rest flagged "needs item") |

Plain English: for a typical job the brain produces a part list where **~2 out of 3
lines are exactly right and need no touch**, **9 of 10 of the right parts are
present**, and **3 of 4 item lines come pre-linked to stock**. The engineer reviews
and fixes the rest instead of building 200+ lines by hand. That is the time saving.

This is a **floor, not a ceiling** — it's pure "copy the most similar past job +
formula-adjust", with no drawing read yet and before the known accuracy levers
(below) are switched on.

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
Inventory resolution (27,092 item lines): 74.8% linked, 6,818 flagged
```

## Where it's strongest / weakest

- **Strong**: structural + sized parts — Guide Rail, Sill Angle, Lintone, Headers,
  Cable Hanger, D-Shackle, Bull Dog Clips, Troughing, Pit Ladder, Facia (resolution
  90–100% in these categories).
- **Weak**: free **fasteners / fixing kits** (bolts, reed/toci kits) — high variance,
  multi-size; they're copied from the nearest job and are the bulk of the misses.
  These are cheap consumables bought in bulk, so low precision there is low-cost.

## Known accuracy levers (not yet switched on — Milestone 2)

1. **Drawing read (vision)** — replace the hand-typed spec with features read from
   the GA drawing (travel, openings, door width) → tightens the travel-scaled
   quantities (Guide Rail, Troughing) the spec alone can't pin down.
2. **Top-K consensus** — vote presence across the 5 nearest jobs instead of copying
   one, to cut both false positives and false negatives.
3. **Rules band-sizing** as a sanity override when no close neighbour exists.
4. **More canonicalisation** — material (PVC/MS) and side (LHS/RHS) variants, and a
   few truncated labels, still split a handful of parts.

## Reproduce

```bash
node scripts/partlist-brain/parse-corpus.js       # -> data/corpus.json
node scripts/partlist-brain/mine-quantities.js    # -> data/quantity-models.json
node scripts/partlist-brain/extract-rules.js      # -> data/rules.json, vocab.json, templates.json
node scripts/partlist-brain/resolve-inventory.js  # -> data/resolution.json   (reads Supabase)
node scripts/partlist-brain/backtest.js           # -> data/backtest.json
```
