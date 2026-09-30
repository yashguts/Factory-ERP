# Drawing deep-scan

Reads every job's current GA drawing page by page and stores a complete
machine-readable record in `job_drawing_extractions`:

| schema_version | what | read by |
|---|---|---|
| `deep_v1` | everything: rich spec + every dimension, per-page views, anomalies | future BOM / packing-list work |
| `rich_v2` | the app-format spec (same top-level fields, no `deep`) | job AI auto-fill, Part List |
| `ralph400_v1` | RALPH 400 calculator inputs (Factory-made structure jobs only) | `/ralph400` instant auto-fill |

First full run: 2026-09-29/30, all 363 drawings (median 94 dimensions each).
Review workbook from that run: `Drawing Scan Review.xlsx` in the project folder.

## When to re-run

Re-uploading a job's drawing deletes that job's stored extractions
(`resetPartListForNewDrawing` in `src/lib/actions/partlist.ts`), so new and
changed drawings show up as incomplete. Ask Claude to "run the drawing deep-scan".

## How it runs

1. `node check.js --all` lists every job whose CURRENT drawing lacks
   deep_v1 + rich_v2 (+ ralph400_v1 for Factory-made structure).
2. Parallel agents follow `INSTRUCTIONS.md`: download, read every page, write
   `jobs/<JOB>.json`, then `node post.js jobs/<JOB>.json`.
3. `post.js` refuses changed drawings, validates structure and enums, computes
   discrepancies vs the ERP entry, derives rich_v2, never duplicates, and
   inserts rich_v2 LAST so "latest extraction" readers get the rich shape.
4. `node check.js --all` again to confirm; repair anything left over.

Run agents in waves of about 5 to stay under account rate limits. Both scripts
read the Supabase URL + anon key from the repo's `.env.local`. Scratch output
(`pdfs/`, `jobs/`, work lists) is gitignored. `exemplar_deep.json` is a real
record with the customer's details anonymised.
