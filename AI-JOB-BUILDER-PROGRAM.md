# Automatic Job Builder — Master Program & Continuation Handoff

> The owner wants: upload a GA drawing → AI auto-fills the entire job (spec + every
> BOM item) → engineer audits/edits → over months it reaches ~99%. This file is the
> single source of truth for the program so ANY session can continue without context loss.

## HARD GUARDRAILS (owner-stated, never violate)
- **NEVER modify ERP business data** (jobs, job_bom_lines, items, inventory, programs, etc.).
  Read-only. The ONLY write into a job is when a human presses **AI Auto-Fill** on that job —
  and even then the AI only fills the form as a DRAFT; the job's BOM is written solely by the
  user's own Save. The AI never commits business data itself.
- The AI MAY write to its OWN understanding stores: `job_drawing_extractions`,
  `job_field_suggestions`, `ai_accuracy_snapshots`, and study/rulebook files in the repo.
- (The floors→stops migration 024 was a one-time owner-requested change; no more data edits.)

## WHAT'S BUILT & LIVE (verified)
- **Spec→BOM retrieval engine** (`src/lib/bom/predict-core.ts` pure + `actions/bom-predict.ts`):
  k-NN over past jobs, label-noise aware, gate-correct, floor(=stops)-scaled qty, per-line
  confidence. Backtest on real jobs: section-F1 0.95, item-hit 84%, qty±10% 85%, **71% keep-rate**.
- **Drawing→spec vision** (`actions/spec-vision.ts`, raw fetch, model `claude-opus-4-8`, base64 PDF,
  forced tool). RICH extraction: spec + 11 dims + ~49 additional_details. Reads `ANTHROPIC_API_KEY`
  (live in Netlify); absent → graceful fallback to typed spec. Stores every read to
  `job_drawing_extractions` (migration 023) with discrepancy detection. Verified live (BBSR-314).
- **AI Auto-Fill UI** (`components/jobs/autofill-review-modal.tsx` + job-form.tsx button):
  reads drawing → spec, retrieval → BOM, review modal w/ confidence + provenance, apply into the
  EXISTING picker (additive; never auto-saves), capture suggestion-vs-saved on Save. Verified e2e.
- **Flywheel**: `job_field_suggestions` logs every suggestion vs final; `ai_accuracy_snapshots` +
  `nightly_ai_maintenance()` on **pg_cron 01:00 IST** (migrations 021/022) re-tag completeness +
  record keep-rate. Retrieval reads LIVE audited jobs → pool grows with zero retrain.
- **`jobs.floors` = TOTAL STOPS** (migration 024; form dropdown is plain "Stops"; spec_string
  "N Stops/Drive/Capacity"). Fixes the off-by-one at the source.

## THE RULEBOOK APPROACH (how it gets smart)
Two layers, both feeding AI Auto-Fill:
1. **Deterministic rules** (encode the high-confidence, verifiable patterns into predict-core):
   landing-side qty = stops; door-token propagation (operation/finish/glass/width → every door
   item name); drive token (MRL/Home/Belt) in item names; dual DBG (car vs counter); rail-dim
   reorder; governor always roped; capacity→Machine-Unit "N pass" + sheave/rope signature; buffer-
   type token. (See AI-DRAWING-STUDY-BATCH1.md + AI-DRAWING-RULEBOOK.md.)
2. **Retrieval** (k-NN over the corpus) for everything the rules don't cover. Improves as audited
   jobs accumulate.

## PASS 1 — DONE (2026-06-13)
- **Full read DONE**: all **112** drawings read by parallel agents (workflow wf_834ef3d1-4f0,
  122 agents, 9.2M tokens, read-only). Per-job studies in `scripts/_study/<jobId>.json` (112 files).
- **Corpus loaded DONE**: 112 rich extractions in `job_drawing_extractions`
  (schema_version `rich_v1_backfill`) via `scripts/load-study-corpus.mjs`. AI understanding store, not business data.
- **Rulebook DONE**: `AI-DRAWING-RULEBOOK.md` (779 lines) — cross-cutting rules, 6 per-drive sections,
  token grammar, quantity decision table, 6 data-quality gates, and an honest confidence split
  (10 rules SAFE to encode now; some ESTIMATE-only; HYD/MRL-BELT draft-only, n≈1).
- **Backtest re-validated** (post floors→stops): section-F1 0.96, item-hit 84%, qty±10% 85.5%,
  keep-rate 71.7%, vs 55.7% gate-only baseline. No regression.

## CONTINUATION CHECKLIST (next passes)
1. **Encode the 10 SAFE deterministic rules** from AI-DRAWING-RULEBOOK.md Part 6 into
   `predict-core.ts` — ONE AT A TIME, re-running `scripts/backtest-bom-predict.ts` after each and
   KEEPING ONLY changes that beat 71.7% (never regress). Drafts only; never writes ERP data.
   Highest value: landing-qty=L & sill=L+1 (already via scaling), door-token propagation for
   sparse-neighbour cases, name composition, never-present list (suppress false sections).
5. **Honest nightly learning**: the flywheel already accrues corrections. A periodic (NOT literally
   nightly — overfits on tiny data) re-derivation of the rulebook from the growing corpus is the
   mechanism; cadence ≈ weekly/as enough new audited jobs land. Decide with owner whether to
   automate via a scheduled agent (cost/fragility trade-off) or run on request.
6. **Iterate**: each pass — find gaps (drive types/configs under-covered, low-confidence sections),
   read more drawings at granular level, refine rules, re-backtest. Accuracy climbs over months;
   99% on the long tail is aspirational, high-90s on common configs is the realistic target.
7. **Open vetting decision**: split `drive_type` into machine_topology / suspension_media /
   frame_type (BELT=MRL+belt, CANTI=frame, an "MR" is really MRL). Owner call; bigger schema change.

## KEY FACTS
- Supabase project `qwzisnmueuqnzzokkpmn`; Netlify auto-deploys main; verify LIVE not local.
- Vision request shape VALIDATED: model `claude-opus-4-8`, anthropic-version 2023-06-01, base64
  PDF document block, forced tool_choice. Key is in Netlify env (owner rotated the pasted one).
- Workflow `args` global is unreliable — INLINE data or fetch via a Phase-0 agent (don't rely on args).
- Batch-1 workflow miss: pipeline returns only the LAST stage, so stage-1 rich extractions weren't
  captured. Fix (this pass): agents WRITE per-job files; synthesis reads files.
