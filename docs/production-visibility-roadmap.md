# Production Visibility — Roadmap

> **Status:** Phase 0 (Programs Library) in progress as of 2026-05-29.
> This document captures *where production tracking is going and why*.
> For *how to work on the project*, see [`CLAUDE.md`](../CLAUDE.md).

---

## The problem (owner's words)

> "We don't have defined BOMs against which we produce for jobs. All our jobs
> are customised. We're still in the process of defining which assemblies have
> what sub-assemblies. Basically a complete mess and only people have
> information in their head."

**Factory layout:** CNC punch + CNC laser + CNC bending (the heart) → powder
coating line → manual fab (cutting, welding, fitting).

CNC programs are designed so that "whatever item they require (let's say car
doors) — all the associated materials come out in one sheet — car door panel,
brackets, post, etc." Data exists on what programs exist and what they produce,
but many output parts haven't been named in inventory yet because there was
never a reason to track them individually.

**What the owner wants:** maximum *visibility* (anyone can see what's going on)
and *control* (decide what to run, when, in what order, with material/bottleneck
awareness).

---

## The reframe that unlocks everything

Off-the-shelf ERP models BOM as "to make X, consume these inputs" — a single
output. This factory works the opposite way: **one CNC program, run once,
produces many parts simultaneously** (the nest). Forcing the factory into a
traditional single-output BOM lies about how production actually happens.

**The atomic unit of production in this factory is the _operation_ (program),
not the part.** Modelling operations as primary unlocks three things:

1. **Honest co-production** — many outputs from one run is a first-class
   concept, not a hack.
2. **Customised jobs become tractable** — a custom job is "this set of
   operations × this many runs each, with this finish."
3. **Visibility becomes mechanical** — "where is the car door panel right now?"
   is answered by "operation X was run on date Y, output 12 panels reserved for
   job Z, currently waiting at the powder coat station."

---

## The three-layer model

```
LOGICAL    (what the elevator is made of — already partially captured)
    Job ─► Assembly ─► Sub-assembly ─► Part
                              │
                              │ "producible by"
                              ▼
PRODUCTION (how parts come into existence — the new layer)
    Operation ──► Operation Run ──► Outputs (multi-part per run)
        │  inputs:  raw items × qty per run
        │  machine: cnc_punch | cnc_laser | cnc_bending | powder_coat | manual_*
        │  sketch:  PDF/PNG attached
        └─ on run completion: debit raw inv, credit part inv (existing transactions)
                              │
                              ▼
EXECUTION  (where things physically are right now)
    Station kanban per machine: queued → in_progress → done → blocked
```

The current ERP has solid coverage of **LOGICAL** (`BOM_SECTIONS`,
`item_categories`, `jobs`, `job_bom_lines`) and the data foundation for
**EXECUTION** (`inventory`, `inventory_transactions`). What's missing is the
**PRODUCTION** middle layer that bridges demand → supply. That middle layer is
the whole point of this initiative.

---

## Phased rollout

Each phase has standalone value **and** forces the previous phase's data quality
to improve. Don't skip ahead.

| Phase | Build | Inventory effect | What it unlocks |
|---|---|---|---|
| **0. Programs Library** | `operations` + `operation_inputs` + `operation_outputs` + `/programs` page | None — pure catalog | Institutional knowledge captured. Each item shows "Produced by" / "Consumed by". |
| **1. Operation Runs** | `operation_runs` + run-logging UI + auto-post to `inventory_transactions` | Yes — debit raw, credit parts | Real raw-material burndown, real part build-up, runs appear in Daily Changes. |
| **2. Job production plan** | `job_production_plan` table; per-job dashboard (required parts → planned runs → completed runs); reservation; auto-suggest plan from `job_bom_lines` | Reservations gate available stock | Per-job "what's done / planned / not yet possible". MRP gains sub-states. |
| **3. Shop-floor kanban** | `/shop-floor` page, one column per machine, drag a run between `queued → running → done` | None new | "Where is each job physically right now." Bottlenecks visible. |
| **4. Planning intelligence** | Cross-job batching suggestions, material runway alerts, scrap/yield trends | Read-only analytics | Proactive procurement, batching efficiency, quality improvement. |

Phase 0's catalog can sit alone for a week while the team populates it — that's
a **feature**, not a bug. Let the catalog grow first, observe the shape it
takes, then build Phase 1 informed by reality rather than guesses.

---

## Data model

### Phase 0 tables

**`operations`** — catalog of every program/recipe.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text NOT NULL | e.g. "Car Door Panel V2" |
| `code` | text UNIQUE | short ref, e.g. "CNC-PUNCH-CD-PANEL-V2" |
| `machine` | text NOT NULL | CHECK in `cnc_punch`, `cnc_laser`, `cnc_bending`, `powder_coat`, `manual_cut`, `manual_weld`, `manual_fit`, `assembly_fit` |
| `description` | text NULL | |
| `sketch_url`, `sketch_filename`, `sketch_uploaded_at` | | one sketch per operation, in Storage |
| `notes` | text NULL | |
| `is_active` | boolean default true | |
| `created_at`, `updated_at` | timestamptz | |

**`operation_inputs`** — raw materials consumed per run.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `operation_id` | uuid FK → operations | ON DELETE CASCADE |
| `item_id` | uuid FK → items | NO ACTION (referenced items can't be hard-deleted) |
| `qty_per_run` | numeric NOT NULL | CHECK > 0 |
| `notes` | text NULL | |
| `sort_order` | int default 0 | |
| `created_at` | timestamptz | |

**`operation_outputs`** — parts produced per run. **Same shape as
`operation_inputs`.**

### Phase 1 table (don't build yet)

**`operation_runs`** — actual executions.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `operation_id` | uuid FK → operations | |
| `job_id` | uuid FK → jobs NULLABLE | NULL = standing inventory / not job-specific |
| `runs` | int NOT NULL | CHECK > 0 — how many times the program ran in this batch |
| `status` | text | CHECK in `queued`, `in_progress`, `done`, `blocked`, default `queued` |
| `scrap_notes` | text NULL | |
| `started_at`, `completed_at` | timestamptz NULL | |
| `created_at` | timestamptz | |
| `created_by` | uuid NULL | |

On `status → 'done'`, the server action posts `inventory_transactions` rows for
each input (`production_out`) and each output (`production_in`), tagged
`reference_type='operation_run'` and `reference_id=run id`. Every run then
appears automatically in the Daily Changes feed.

### Conventions for new tables

- Permissive RLS (anon "Allow all"), `GRANT ALL` to anon/authenticated/service_role
  — matches every existing table (auth still isn't wired).
- Storage bucket `program-sketches` (public, 50 MB cap, MIME whitelist
  PDF/PNG/JPG/WebP, paths `{operationId}/{ts}-{filename}`). Mirrors the
  `gad-drawings` bucket; replacing a sketch deletes the previous file.

---

## The "knowledge is in heads" philosophy

The dominant failure mode would be designing a complete system, demanding the
team document everything upfront, and watching it get abandoned because the
documentation cost is too high. Counter-design principles, baked into every
phase:

- **Placeholders everywhere.** The output picker can create a new item inline
  (pre-filled `item_type='sub_assembly'`, NULL category, placeholder name). The
  team renames later. Directly addresses the "many parts not yet named" reality.
- **Forcing function.** First time someone logs a run (Phase 1), the form asks
  "what came out?" with the operation's defined outputs prefilled. They confirm
  or correct. The catalog improves as a byproduct of normal work, not a separate
  documentation project.
- **Loud gaps.** Phase 2's job dashboard turns red on any required part with no
  operation defined. A "Needs a program" list surfaces items with no
  `operation_outputs` row. The system pulls people toward filling gaps that
  block real work.
- **One job at a time.** Document the next real job end-to-end and you've
  captured ~70% of factory patterns. Second job → 90%. After 5–10 jobs →
  templates emerge.
- **No upfront perfection.** Phase 0 is catalog-only. Don't wire runs/inventory
  before the team has put a few programs in.

---

## Open design decisions (need owner input before Phase 1)

1. **Manual fab modelling.** Model welding/fitting/cutting as "operations" too,
   or only formalise CNC + powder coat? _Recommendation: model them, but with
   looser input requirements (often outputs-only)._
2. **Surplus parts.** A program produces 10 brackets but the job needs 6 — where
   do the other 4 go? _Recommendation: a general parts pool, available to the
   next job that needs them._
3. **Run-logging UX.** Operator on a shop-floor tablet (live, mobile-friendly,
   minimal-keystroke) vs supervisor end-of-day from a paper sheet (desktop
   list-entry) vs both? _Drives Phase 1 UI shape._
4. **Reservation semantics (Phase 2).** Are produced parts "reserved for that
   job" (locked out of other jobs' MRP) or "available to anyone"?
   _Recommendation: explicit reservation per job, with a visible "borrow"
   override._
5. **MRP evolution (Phase 2).** MRP gains sub-states: `needed` /
   `planned-runs-not-yet-done` / `produced-and-reserved` / `in-stock-general`.
   Worth a mockup before building.

---

## What we lean on (don't duplicate)

- **`items` + ~1,798 SKUs.** Operations reference items. The `item_type` enum
  (`raw_material`, `sub_assembly`, `finished_good`, `mechanical_finished_stock`,
  `door_panel`) is sufficient for output classification.
- **`inventory` + `inventory_transactions`.** Phase 1 runs post into these via
  the existing `recordTransaction` helper. The Daily Changes feed surfaces runs
  automatically (they're transactions tagged `production_in` / `production_out`).
- **GAD drawings infra** (`gad-drawings` bucket + `gad-drawings.ts` helpers +
  `gad-drawing-panel.tsx` viewer). Mirror it for `program-sketches`.
- **Cache strategy** (`unstable_cache` + `revalidateTag`) — new tag
  `"operations"`.
- **Discriminated-result pattern** (`{ok:true; id} | {ok:false; error}`) — apply
  to all new actions. See `createItem` + `translateItemError` in
  `lib/actions/inventory.ts`.
- **Legacy `bom_headers` / `bom_lines`** — do **not** model the production layer
  here. New tables for new concepts.
