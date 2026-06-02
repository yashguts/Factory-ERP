# Factory ERP — Elevator Manufacturing

ERP for an elevator-manufacturing business in India. Tracks inventory, BOMs,
job orders and material requirements (MRP). Built incrementally with the
owner (a non-developer) over several iteration sessions.

---

## 0 — Before you write any code

### Branch strategy: judge before you push

The owner is not a developer. They want you to make the call about whether
a change goes on `main` or a feature branch. **Use this rubric:**

| Change type | Branch? |
|---|---|
| Typo, copy tweak, label rename | `main` |
| Bug fix (small, localised) | `main` |
| New small feature on existing surface (e.g. add a column to a table, add a button) | `main` |
| Schema change with risk (renaming columns, dropping data) | **branch + PR** |
| Big refactor touching >10 files | **branch + PR** |
| Speculative / experimental work | **branch + PR** |
| Feature that needs review or might be reverted | **branch + PR** |

When you start a feature branch, **tell the owner explicitly** so they're
not surprised when "the change didn't show up". Use `git checkout -b
feature/short-name`, ship the work, then either merge yourself or open a
PR depending on what you discussed. Default to merging via `git merge`
after the owner confirms — the owner won't review code, they'll review
the deployed app.

### Hand-holding the owner

They iterate fast and trust you to do the right thing. Concretely:

- **Explain what you did** in plain language at the end of each change.
  Always mention which page/button/flow is affected.
- **Tell them when to expect deploys to be live.** Netlify auto-deploys
  on push to `main`; it takes ~1 minute. After a deploy they often need
  to hard-refresh open tabs (see "Stale deploy guard" below).
- **Confirm destructive operations before running them.** Always do a
  count/preview query before any `DELETE` or `UPDATE` that touches more
  than one row.
- **Don't make them remember Git/SQL commands.** You operate the tooling.
- **Surface trade-offs, don't hide them.** If a quick fix has a cost,
  say so. Let them decide.

### Required workflow for every change

1. Read the files you're about to change.
2. Make the edits.
3. `npx tsc --noEmit` — must come back clean.
4. `git add <files> && git commit -m "..."` (clear, paragraph-style messages).
5. `git push` to `main` (or to your feature branch).
6. Tell the owner what changed, where they'll see it, and when it'll be live.

---

## 1 — Tech stack & infrastructure

- **Frontend**: Next.js 15.5 (App Router), React 19, TypeScript, Tailwind 4.
- **Database**: Supabase (Postgres, project `qwzisnmueuqnzzokkpmn`, region ap-south-1).
- **File storage**: Supabase Storage, bucket `gad-drawings` (public, 50 MB cap, PDF + common images).
- **Hosting**: Netlify (auto-deploys `main`). URL pattern `lt-factory-erp.netlify.app`.
- **Auth**: **not yet wired**. The Supabase anon key is used for everything.
  RLS policies are permissive (anon role allowed) on every table. When auth
  is added, the cache strategy below will need revisiting.

### Build commands

```bash
npm run dev      # local dev
npm run build    # production build (the same one Netlify runs)
npx tsc --noEmit # type check only — fastest way to validate edits
```

### Available MCP tools

- **Supabase MCP** (`mcp__ea97dc09-*__*`): query the DB directly via
  `execute_sql`, apply migrations via `apply_migration`, read Postgres
  logs via `get_logs`. Used heavily during sessions for SQL ops the user
  shouldn't have to do manually.
- **Netlify MCP** (`mcp__2a221f86-*__*`): read deploy state, manage env
  vars. Use sparingly — pushing to `main` is usually enough.
- **Claude Preview MCP** (`mcp__Claude_Preview__*`): can launch a real
  browser to verify changes. Worth using for visual checks.

---

## 2 — Project structure

```
src/
  app/
    (app)/                  Route group with shared sidebar
      page.tsx              Dashboard (mostly placeholders)
      inventory/
        page.tsx            Server component, loads items+categories+units+warehouses
        import/             Excel import flow
        loading.tsx         Skeleton
      jobs/
        page.tsx            Jobs list
        new/page.tsx        New job form
        [id]/page.tsx       Job detail
        [id]/edit/page.tsx  Edit job
        unmatched/page.tsx  BOM-line-to-item mapping helper
        import/             Excel import (legacy)
        loading.tsx         (and various per-route loadings)
      mrp/page.tsx          Material Requirements Planning
      programs/
        page.tsx            Programs list (server component)
        [id]/page.tsx       Program detail
        loading.tsx         Skeleton
      inventory/
        changes/page.tsx    Inventory Daily Changes (item edits + stock moves)
        [id]/page.tsx       Item detail (identity + Built-from + Assembly parts)
      subassemblies/
        page.tsx            Sub-assemblies list (items with a parts list) + define-search
        loading.tsx         Skeleton
      bom/page.tsx          Standalone BOM (placeholder)
      settings/page.tsx     Placeholder
      layout.tsx            AppShell wrapper
    layout.tsx              Root layout (includes StaleDeployGuard)
    globals.css             CSS vars + Tailwind imports
  components/
    ui/                     Reusable primitives (Button, Input, Select, Modal, Table)
    layout/                 AppShell, Sidebar, StaleDeployGuard
    inventory/              Inventory page + form modal + stock adjust + item detail
                            (Built-from/Assembly parts) + loose-part picker + sub-assemblies
    jobs/                   Job form, detail, BOM picker, GAD drawing panel, template picker
    mrp/                    MRP table + per-item jobs popover
    programs/               Programs list, form modal, detail, sketch panel, line picker
  lib/
    utils.ts                cn() utility
    supabase/
      client.ts             Browser Supabase client (rarely used)
      server.ts             SSR Supabase client (cookies-aware) — for mutations
      cache-client.ts       Anon Supabase client (no cookies) — for cached reads
      types.ts              Hand-maintained TypeScript types matching the DB
    actions/                Server actions, one file per domain
      categories.ts         getAllCategories, resolveCategoryPaths, etc.
      items.ts              searchItems for the BOM picker (live search)
      inventory.ts          getItemsWithStock, createItem, updateItem, deleteItem
      jobs.ts               getJobs, getJobDetail, createJob, updateJob, deleteJob,
                            saveBomSection, getJobTemplate, etc.
      mrp.ts                getMrpData, getMrpItemJobs
      dispatch.ts           Job dispatch: getJobDispatchSummary (required/sent/
                            left), createDispatch, deleteDispatch, status badges
      operations.ts         Programs CRUD, sketch upload, audit toggle
      item-bom.ts           Item parts list (Built-from/Assembly parts), loose-part
                            search + promote, getSubassemblies
      inventory-changes.ts  Daily Changes feed + per-item history (edits + stock
                            moves + undo); getItemChangeHistory
      gad-drawings.ts       uploadGadDrawing, deleteGadDrawing
      bom-mapping.ts        Unmatched-BOM helpers
      import.ts             Item Excel import
      jobs-import.ts        Job Excel import
    bom/
      bom-sections.ts       BOM_SECTIONS + PHASE_ORDER — single source of truth
                            for which sections show on a job form
      section-gating.ts     Door/drive type selectors + gating logic
    inventory/
      next-code.ts          Auto-suggest next code in series for clone
supabase/migrations/         SQL migrations applied to the project
```

---

## 3 — Database schema (current, not seed)

### Core tables

**`items`** — every SKU in inventory.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text **UNIQUE** | e.g. `SA-HD-057`. Pattern `PREFIX-NNN` enforced by convention, not DB. |
| `name` | text | **Display name everywhere.** Must be unique among active items (partial unique index on `lower(trim(name)) WHERE is_active`). |
| `lookup_key` | text | Legacy field. We sync `lookup_key = name` on every update via `updateItem`. Search falls back to it but display does not. |
| `description` | text \| null | |
| `item_type` | enum | `raw_material` \| `sub_assembly` \| `finished_good` \| `mechanical_finished_stock` \| `door_panel`. Several of these are legacy from the Excel imports. |
| `category_id` | uuid \| null → item_categories | Usually a sub-category. |
| `uom_id` | uuid → units_of_measurement | |
| `minimum_stock`, `reorder_point`, `lead_time_days`, `cost_price` | numeric / int | |
| `is_active` | boolean | Soft-delete flag. Hidden items remain referenced from BOMs/transactions. |
| `procurement_type` | text \| null | `'make' \| 'trade' \| null`. NULL means "inherit from category". |
| `suppliers` | text[] | Max 5, enforced by CHECK. Cleared automatically when item becomes Make. |
| `created_at`, `updated_at` | timestamptz | |

**`item_categories`** — hierarchical taxonomy.

| column | notes |
|---|---|
| `id` PK | |
| `name`, `parent_id` | parent_id null = top-level. We have 2-3 level deep trees. |
| `procurement_type` | category-level default Make/Trade. Items inherit unless they override. |

Use `lib/actions/categories.ts` helpers (`resolveCategoryPaths`,
`expandCategoryDescendants`) to convert path strings like
`"Hardware > Bull Dog Clips"` to category IDs and to include descendants
when searching by a parent.

**`units_of_measurement`** — UOM master.

**`warehouses`** — locations. Inventory balance is per-(item, warehouse).

**`inventory`** — current stock balance, one row per (item_id, warehouse_id).

**`inventory_transactions`** — history of stock moves (in, out, adjust).

**`bom_headers` / `bom_lines`** — template BOMs (older feature, mostly unused now).

**`jobs`** — job orders.

| column | notes |
|---|---|
| `job_number` UNIQUE | user-supplied |
| `customer_name`, `location` | required in the form |
| `status` | enum `new`/`in_production`/`hold` |
| `stage`, `requirement_stage` | enum `new`/`first_phase`/`full_material` |
| `requirement_dispatch_date` | drives MRP cutoff |
| `floors`, `drive_type`, `capacity` | elevator spec |
| `structure_included` | `'NA'\|'Factory-made'\|'Site-fabricated'`, default `'NA'` |
| `spec_string` | derived (`G+N/DriveType/Capacity`), saved as denorm |
| `door_type`, `door_finish`, `brand`, `order_date`, `expected_delivery`, `remark`, `progress`, `planned_*`, `actual_*`, `notes` | **legacy fields not surfaced in the current form.** Still in DB so existing data isn't lost. New items coming in via createJob/updateJob from the form skip these intentionally (Supabase `undefined` = don't touch). |
| `gad_drawing_url/filename/uploaded_at` | one drawing per job, in Supabase Storage |

**`job_bom_headers`** — one per job (`job_id` FK with CASCADE).

**`job_bom_lines`** — line items: `job_bom_id` FK (CASCADE), `category` (display section name from `BOM_SECTIONS`), `item_id` (FK to items, NO ACTION — items used here can't be hard-deleted), `required_quantity`, `variant`, `value_text`, `sort_order`.

**`job_dispatches` / `job_dispatch_lines`** — dispatch records (Phase 0, **no
inventory effect**). `job_dispatches`: one per dated shipment (`job_id` CASCADE,
`dispatch_date`, `phase_scope` CHECK `first`/`second`/`full`, `note`).
`job_dispatch_lines`: `dispatch_id` FK (CASCADE), `job_bom_line_id` (FK SET NULL
— the BOM line fulfilled; NULL = ad-hoc item not on the BOM), `item_id` (the item
actually sent, may differ from the BOM line), `category`, `qty`. Remaining per
BOM line = `required − Σ dispatched`; partials accumulate across dispatches.

**`operations`** — programs / recipes (production-visibility Phase 0).

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | Program name, e.g. "Car Door Panel Nest V2". |
| `code` | text UNIQUE | Auto-derived `CNC-SLUG` or `ASM-SLUG` if left blank. |
| `machine` | text CHECK | `cnc_laser` \| `cnc_punch` \| `assembly_fit` (active). Legacy: `cnc_cutting` + others in constraint for later phases. |
| `family_key` | text \| null | Groups material/finish variants of the same base program. |
| `material_label` | text \| null | e.g. "MS", "SS", "SS Rose Gold". |
| `program_label` | text \| null | Set grouping, e.g. "Standard Programs". |
| `import_source` | text \| null | null = manual; tag like `cnc_std_v1` = bulk import. |
| `audited_at` | timestamptz \| null | Set when program is reviewed; null = pending. |
| `sketch_url/filename/uploaded_at` | text / timestamptz | One sketch per program, in `program-sketches` bucket. |
| `description`, `notes` | text \| null | |
| `is_active` | boolean | |
| `created_at`, `updated_at` | timestamptz | |

**`operation_inputs`** — raw materials consumed per run.

| column | notes |
|---|---|
| `id` PK, `operation_id` FK (CASCADE) | |
| `item_id` FK → items (NO ACTION) \| null | null = "to be filled" (unresolved from import). |
| `label` | Captured original name for to-be-filled lines. |
| `qty_per_run` | numeric > 0. |
| `notes`, `sort_order`, `created_at` | |

**`operation_outputs`** — parts produced per run. Same shape as `operation_inputs`,
plus `role` (text CHECK): `component` (a real/stocked item — links to inventory) |
`cut_part` (intentional phantom — cut & fitted, never stocked) | `tooling`
(jig/template) | `scrap`. Default `component`. The Programs UI's "needs item"
badge only fires on **unmapped `component`** outputs (true gaps); cut_part/tooling
are "resolved". Editable via the per-output role selector on the program form.

### Production-visibility foundation (Phases A–C)

Underneath jobs/programs sits a multi-level product structure. Job upload/creation
is **unchanged** (locked); this only reads what a job asks for and explodes it.

- **`items.stock_behaviour`** (text CHECK): `stocked` | `phantom` | `tooling`.
  Orthogonal to `procurement_type` (make/trade). MRP/planning ignores `tooling`.
- **`items.family` / `items.finish`** — group finish variants of one part
  (mirror programs' `family_key`/`material_label`). NULL = not a finish family.
- **`item_bom_lines`** — an assembly item's multi-level parts list ("Built from"):
  `parent_item_id` → child, `qty`, and a **`finish_rule`**: `inherit` (child takes
  the parent's finish — resolved via `child_family` + parent finish), `pinned`
  (fixed `pinned_finish`, e.g. an MS bracket inside an SS door), or `neutral`
  (the exact `child_item_id`, no finish dimension). `child_item_id` always stores
  a representative; inherit/pinned resolve by `child_family` at explode time.
- **Item detail page** `/inventory/[id]` (`ItemDetailClient`): one-panel identity
  (Bought / Made-cut / Made-assembled) + two parts sections — **"Built from"**
  (stocked sub-parts) and **"Assembly parts"** (loose parts = `phantom` items)
  — both writing `item_bom_lines`, split on load by the child's stock_behaviour;
  one Save persists both. "Create loose part" makes a phantom item. Produced-by/
  consumed-by program links. Actions in `lib/actions/item-bom.ts`
  (`getItemBom`, `saveItemBom`). Inventory rows link the code here.
- **Loose parts** are `phantom` items: link one to the program(s) that cut it
  by adding it as a `cut_part` output; list it under "Assembly parts" on the
  assemblies it fits (many-to-many). The `/mrp/plan` explode routes a phantom
  child through its cut_part program to the sheet.
  - **Program outputs are type-first** (`operation-line-picker.tsx`): each output
    row picks its role (Finished part / Loose part / Tool / Scrap) BEFORE the
    name — a new row is gated until a type is chosen. "Loose part" rows use a
    loose-only picker (`searchLooseParts` — phantoms + cut_part labels) with
    promote-on-pick (`promoteLoosePartLabel` creates/reuses a phantom + relinks
    every program sharing the label); "Create new item" on a loose row makes a
    phantom automatically. Other roles use the normal inventory search.
  - **Sub-assemblies page** `/subassemblies` (`getSubassemblies`) lists every
    item that already has a parts list; the "Define a sub-assembly" search jumps
    to the item detail editor. Starts empty, grows one item at a time.
- **Raw-material plan** `/mrp/plan` (`getProductionPlan` in `lib/actions/mrp.ts`):
  explodes job demand through parts lists (finish-resolved) and programs down to a
  **steel + purchased buy-list**, netted vs stock. Program runs are rolled up at
  whole runs (nesting NOT optimised — it's a conservative estimate, validate by
  hand). Make items with no recipe surface under "cannot explode".

### Storage

- Bucket `gad-drawings` — public, 50 MB cap, MIME-whitelisted to PDF/PNG/JPG/WebP.
  Files at `{jobId}/{timestamp}-{filename}`. Replacing a drawing deletes the previous file.
- Bucket `program-sketches` — public, 50 MB cap, same MIME types.
  Files at `{operationId}/{timestamp}-{filename}`. Same replace-on-upload pattern.

---

## 4 — Key concepts the code assumes

### Item code series

`PREFIX-NNN` with the last `-`-separated segment as a zero-padded integer.
`lib/inventory/next-code.ts` extrapolates the next number in a series. Used
by the clone feature.

`createItem` **auto-generates the code when it is left blank** (the field is
optional on create; typed codes are used as-is). Prefix is `LP` for phantom
(loose) parts, else by item_type (`RM`/`SA`/`FG`/`MFS`/`DP`); it scans the
existing `PREFIX-NNN` codes for the next free number. `createItem`/`updateItem`
now return `code` in the success result so inline pickers get the real code.

### Item name = lookup_key invariant

We migrated `name = lookup_key` for every item and now sync them on every
`updateItem`/`createItem`. **Display reads `name` only.** `lookup_key` is
kept for legacy search fallback. Don't introduce a UI that shows
`lookup_key || name` again.

### Make/Trade procurement type

Set on `item_categories.procurement_type` as the default. Items can override
via `items.procurement_type`. The **effective** value is
`item.procurement_type ?? item.category.procurement_type`. The MRP page
uses this to split its table into "Trade · To Procure" and "Make · To
Manufacture" tabs.

The bulk classification was done once across all 1,593 items — most
items inherit from their category; only `Miscallaneous > Limit Switch
Items` has per-item overrides (it's a mixed bag).

### BOM section model

`src/lib/bom/bom-sections.ts` is the **single source of truth** for the
form's BOM sections. Each section has:

- `category`: display name, also the `category` value stored in
  `job_bom_lines`.
- `phase`: groups sections in the form. Order defined by `PHASE_ORDER`.
- `gate`: `always` | `doorType(...)` | `driveType(...)` | `driveTypeExclude(...)`.

**Dispatch phase** (separate from the form `phase`): `FIRST_PHASE_SECTIONS` +
`dispatchPhaseOf(category)` in `bom-sections.ts` classify each section as
first- vs second-phase **dispatch** (rails/brackets/door-frame/sill/linton/
controller-stand/troughing/fireman-switch = first; everything else = second).
Keyed by the `category` string stored on `job_bom_lines`, so any saved line
classifies directly. Job detail shows a "1st/2nd phase" badge per section; this
is the basis for the (future) split-dispatch flow.
- `defaultItemCategories`: path strings like
  `"Rail Bracket > Rail Bracket Main"`. At search time these resolve to
  category IDs and expand to include all descendants.

Users can also add **ad-hoc sections** at runtime via "+ Add Section From
Inventory" — these aren't in `BOM_SECTIONS` but get reconstructed on
edit from any saved `job_bom_lines` whose category name doesn't match a
hardcoded section.

The form auto-shows a mapping-warning banner inside a section when its
`defaultItemCategories` don't resolve against the live category tree
(usually a sign the user renamed a category).

### Job save semantics

Three buttons on the job form, all anchored to the same source of truth:

| Button | What it does |
|---|---|
| **Save Details** | `updateJob` with current metadata. |
| **Save Phase** | `ensureJob()` (which always persists metadata too) then `saveBomSection(jobId, [categories in this phase], lines)`. |
| **Save All & Finish** | Same as Save Phase but for every visible section, then `router.push(/jobs/{id})`. |

`ensureJob()` always syncs metadata when `savedJobId` exists, so per-section
saves don't silently drop metadata edits. This was a real bug we fixed —
don't undo it.

`saveBomSection` **deletes every existing line** in the affected categories
then inserts the new ones. The picker is treated as source of truth.

### Required form validation

The form enforces these fields are filled before any save action runs:
`Job Number`, `Customer Name`, `Location`, `Stage`, `Requirement Stage`,
`Req. Dispatch Date`, `Floors`, `Drive Type`, `Capacity`. The
`missingFields` memo drives both the disabled save buttons and the amber
banner above the BOM phases.

### MRP requirement computation

`getMrpData` sums `required_quantity` across all `job_bom_lines` for each
item (was previously counting lines, which under-reported — fixed). The
result table is then split into Trade / Make / All tabs based on
`effective procurement_type`.

The "Jobs" column on each row is interactive: hover it to see a popover
listing every job that requires this item, with per-job line count and
total qty. The popover lazy-fetches and caches per item.

### Cutoff date

The MRP page has a "Requirement Dispatch Date up to" filter. Server-side,
`getMrpData(cutoffDate)` first finds all jobs with
`requirement_dispatch_date <= cutoffDate` and only counts BOM lines from
those.

### Programs / operations model

An **operation** (called "Program" in the UI) is a recipe: one run
consumes some raw materials (inputs) and produces many parts (outputs —
the nest). The DB table is `operations`; the code says "operation"
internally and "program" in the UI.

Phase 0 is **catalog-only** — no inventory effects. Phase 1 will add
`operation_runs` that post `inventory_transactions` on completion.

Key mechanics:

- **Machine types**: `cnc_laser`, `cnc_punch`, `assembly_fit` are the
  active values offered in the UI. `cnc_cutting` is a legacy value from
  before the laser/punch split — still rendered, but not offered for new
  programs.
- **Family / material**: `family_key` groups variants of the same base
  nest (e.g. same geometry, different sheet material). `material_label`
  is the variant's material/finish (e.g. "MS", "SS Rose Gold").
- **To-be-filled lines**: `item_id` on inputs/outputs can be null. In
  that case `label` holds the captured original name from the import,
  shown with an amber "needs item" badge in the UI, resolvable later.
- **Audit tracking**: `audited_at` marks a program as reviewed.
  The list shows audited/pending counts and supports filter by status.
- **Codes**: auto-derived as `CNC-SLUG` or `ASM-SLUG` from the name
  if left blank. Uniqueness enforced by DB; `resolveCode` appends `-2`,
  `-3`, etc. on clash.
- **Save semantics**: `replaceLines` deletes all input/output lines and
  re-inserts from the form — same pattern as `saveBomSection`.
- **Sketch**: one PDF/image per program, stored in `program-sketches`
  bucket. Same upload/replace/remove pattern as GAD drawings.
- **Program labels**: grouping tag (e.g. "Standard Programs"). Filterable
  in the list via chip filters.

---

## 5 — Server-action conventions

### Cache strategy

**Read queries** that we want fast → wrap with `unstable_cache` and tag
them. They use `createCacheClient()` (anon, no cookies — wouldn't work
inside `unstable_cache` otherwise). Tags: `"items"`, `"jobs"`,
`"bom-lines"`, `"inventory-stock"`, `"categories"`, `"operations"`.

**Mutations** use the cookies-aware `createClient()` from
`lib/supabase/server.ts`. Every mutation must call `revalidateTag()`
(and often `revalidatePath()`) for the data it touched. The convention is
already in place — follow it.

When a DB change is made via SQL outside the app (e.g. you ran a
migration), the cached reads won't pick it up until the TTL expires
(usually 60s). Either wait or push an empty commit to force a redeploy
(which wipes the build-tier cache).

### Errors from server actions

Next.js 15 **strips error messages** from server actions in production.
Throwing an Error gives the client only:
`"An error occurred in the Server Components render. The specific message
is omitted in production builds..."`

So for **user-visible validation errors**, return a discriminated result
instead of throwing:

```ts
export type ItemSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
```

Both `createItem` and `updateItem` use this pattern, along with
`translateItemError` that converts Postgres error codes (23505, 23503,
23514) into user-friendly messages. Apply the same pattern to any new
server action that has expected validation failures.

### PostgREST quirks

A "belongsTo" relation can come back as either `{...}` or `[{...}]` from
PostgREST depending on the planner. Use the `flatten<T>(rel)` helper
pattern (see `getJobBomItemLines` in `lib/actions/jobs.ts`) when
flattening joined relations.

### Lookup key sync

`updateItem` automatically copies `name → lookup_key` on every update.
Don't add new code that reads or writes `lookup_key` for display — use
`name`.

---

## 6 — Feature inventory (what's built)

### Inventory page (`/inventory`)
- List with stock, M/T badge, type, category, cost, status (OK/Low/Out)
- Multi-token fuzzy search across code/name/description/lookup_key
- Filter by type / category / sub-category / stock state
- Sort, pagination
- **Add Item** modal — full form with Make/Trade dropdown + supplier slots
- **Clone Item** (Copy icon per row) — pre-fills form from source, auto-suggests next code
- **Edit Item** — same modal, with delete button bottom-left
- **Delete Item** — smart hard/soft delete based on references (typed confirmation)
- **Stock adjust** — inline widget per row + modal for full adjustments
- **Excel import** (`/inventory/import`) — preview, validate, commit
- Loading skeleton

### Jobs page (`/jobs`)
- List with status, stage, drive type, brand filters + multi-token search
- Inline-edit status / stage / requirement_stage / dispatch date
- Optimistic local-state updates per row (only the saving row is disabled)
- Loading skeleton

### New job (`/jobs/new`)
- Compact header with "Saved/Unsaved" pill + Save All & Finish
- "Import from Job" button (clones spec + BOM from existing job)
- "Drawing" toggle for split-screen GAD viewer
- Required-field validation banner
- Per-phase Save Section buttons + Save All
- "+ Add Section From Inventory" for ad-hoc categories
- Job Details panel (6 fields) + Elevator Spec panel (4 fields)
- BOM by phase, each phase a card, sections single-column with thin dividers
- N-row picker per section (search → qty → unit → remove + Add Item)

### Edit job (`/jobs/[id]/edit`)
- Same form as New, pre-hydrated from DB
- Per-section save persists immediately
- Drawing panel + split view, opens by default if job has a drawing

### Job detail (`/jobs/[id]`)
- Header with status badge + **Dispatch** + Drawing toggle + Edit BOM + Delete + status dropdown
- Meta strip (job number, customer, spec, floors, drive type, capacity, **structure**, location, brand, dates, stage)
- Progress bar
- **Dispatch panel** — per-phase status (First/Second: Pending / Partial (x/y) /
  Dispatched) + dated history of every dispatch (expandable lines, per-dispatch undo)
- Section view (read-only group-by-phase cards, with 1st/2nd-phase badge) and Item
  view (sortable table, "1st phase" badge on first-phase lines) with toggle
- BOM-line search
- Split-screen GAD drawing on the right

#### Dispatch flow (`dispatch-modal.tsx`, `dispatch-panel.tsx`)
- "Mark dispatched" modal: pick **date** + **scope** (First phase / Second phase
  / Entire job). Scope pre-loads in-scope BOM items showing **Required · Sent ·
  Left**, dispatch-now qty defaulting to what's left.
- Edit qty (partial supported, accumulates across dispatches), **swap the item**
  (sent item may differ from BOM), **add ad-hoc items** not on the BOM,
  over-dispatch allowed (amber hint). NO inventory effect (Phase 0).
- Recording a dispatch **advances the job `stage`** (first → `first_phase`;
  second/full → `full_material`), forward-only — set in `createDispatch`
  (direct `jobs.stage` write; does not touch the locked createJob/updateJob).
  Undo does not regress the stage (edit it manually if needed).
- Jobs list shows a **Dispatch** column badge (Dispatched / Partial / —) via
  `getJobsDispatchStatus`.

### MRP (`/mrp`)
- Three tabs: **Trade · To Procure** / **Make · To Manufacture** / **All** (default = Trade)
- Tab counts as badges
- Date cutoff filter
- Summary cards (filtered by tab): total items, total required, items-with-shortfall, total shortfall units
- Table: Code, Item Name, Type, Category, Required, In Stock, Shortfall, Jobs
- **Jobs hover popover** — per-item breakdown of jobs requiring it (lines + qty), click row to navigate

### Programs (`/programs`)
- List with code, name, machine chip, label, input/output counts
- Multi-token search across program name/code/family + all input/output item names
- Filter chips: by machine type (Laser Cutting / Punching / Assembly), by program label, by audit status (pending / audited)
- Audit progress counter: "X audited / Y pending"
- **Add Program** modal — name, code (auto if blank), machine type, description, inputs picker, outputs picker, notes
- **Clone Program** — pre-fills form from source, auto-suggests next code via `nextCodeInSeries`
- **Quick-edit** (pencil icon per row) — opens form modal pre-filled for editing
- **Audit toggle** (check icon per row) — optimistic mark/unmark audited
- Click row → program detail page
- Loading skeleton

### Program detail (`/programs/[id]`)
- Header with name, code, machine badge, description
- Audit / Clone / Edit / Delete buttons
- **Inputs table** (consumed per run) — item name + code + qty + unit, with "needs item" badge for to-be-filled lines
- **Outputs table** (produced per run) — same format
- **Sketch panel** (sticky right column) — upload/view/replace/remove PDF or image, same pattern as GAD drawings
- Notes section
- Items link back to inventory (`/inventory?edit={id}`)

### Daily Changes (`/inventory/changes`)
- Unified feed of item edits (from `item_change_log`) and stock moves (from `inventory_transactions`)
- Date picker to browse by day
- **Item-history search** (fuzzy, across all categories) — pick an item to switch
  the feed to that item's full change history across all dates (`getItemChangeHistory`;
  cards show the date, not just time). Clear to return to the day view.
- Per-entry undo (one-click revert for item edits, reversing adjustment for stock moves)

### Sub-assemblies (`/subassemblies`)
- Dedicated section (sidebar: after Daily Changes, before Bill of Materials)
- Lists every item that has a parts list (Built-from and/or Assembly parts), with
  per-row built/loose counts + finish-family badge. Starts empty, grows one at a time.
- "Define a sub-assembly" search → pick any item → its `/inventory/[id]` detail
  editor (Built-from + Assembly parts). The detail page is the single editor.

### GAD drawings
- Upload / view / replace / remove per job
- PDF rendered via browser native iframe; images via `<img>`
- Split-screen view (toggle button in header) — form/detail on left, drawing on right, each pane independently scrollable

### Unmatched BOM mapping (`/jobs/unmatched`)
- Lists patterns from old imports where `item_id IS NULL` on `job_bom_lines`
- Bulk-map a pattern to an existing item OR create a new item and map

### Imports
- Items via `/inventory/import` (Excel)
- Jobs via `/jobs/import` (Excel)
- Both use Excel parsers under `lib/import/`

### Cross-cutting
- **Stale-deploy guard** (`StaleDeployGuard` in root layout) — listens for the Next.js "Server Action X was not found on the server" error and shows an amber toast prompting reload
- Loading skeletons for the heavy list pages
- `cache-client.ts` wraps reads, `revalidateTag` invalidates them on writes

---

## 7 — Common things you'll be asked to do

### "Add a field to jobs"

1. SQL migration: `ALTER TABLE jobs ADD COLUMN x ... DEFAULT '...'`.
2. Update `Job` interface in `lib/supabase/types.ts`.
3. Add the field to `buildJobData()` in `job-form.tsx` (and `JobDetailsPanel` / `ElevatorSpecPanel` if it's a UI surface).
4. Widen the parameter types of `createJob` / `updateJob` / `createJobWithBom` / `updateJobWithBom` to accept it.
5. Optionally show it on `JobDetailClient` meta strip.

### "Rebind a BOM section to a different category"

Just edit `lib/bom/bom-sections.ts`. Each section's
`defaultItemCategories` is a list of path strings. Use the inventory's
real category names (case-sensitive, the DB has some typos like
`Pannel`, `Miscallaneous`, `Thimbel` — preserve them as-is).

### "Bulk update items via SQL"

Use the Supabase MCP `apply_migration`. After the migration, **push an
empty commit** to force a Netlify redeploy → cache wiped → users see
fresh data immediately. Otherwise they wait 60s for the TTL.

### "Why isn't the change showing up?"

Layered caches:

1. **Browser Router Cache (RSC payloads)** — `router.refresh()` or hard reload
2. **Next.js data cache (`unstable_cache`)** — 60s TTL or `revalidateTag` on the server
3. **Netlify build-tier cache** — wiped only on redeploy

After SQL changes, push an empty commit. After app changes, the deploy
already wipes it.

---

## 8 — Pitfalls / quirks

- **DB has typos in category names**: `Pannel` (not Panel), `Miscallaneous`,
  `Thimbel`, `Pully`, `Bracket Trey`. Don't fix them — the data already
  references these strings. Match them exactly when binding sections.
- **`door_type`** column on jobs is currently dead — the spec field was
  removed from the form. The column still exists in DB. The MAIN BRACKET
  section's `driveTypeExclude` gate is the only door_type-adjacent thing
  that matters.
- **Categories named the same as their parent** are common after the
  import (e.g. `By Parting Door > By Parting Door`). Don't try to
  normalize; the BOM bindings depend on the full path.
- **`useMemo` for seeded picker rows**: if you ever change
  `ItemPickerSection`, **keep the `seedRow = useMemo(() => emptyRow(), [])`**.
  Without it, every render gives the seed row a fresh `_key` and React
  remounts the `<input>` — which used to steal focus to the last empty
  section while the user was typing in Job Number.
- **Server actions on long-open tabs**: every Netlify redeploy changes
  action hashes. The `StaleDeployGuard` will prompt the user to reload —
  don't be alarmed if you see "Server Action X was not found" errors in
  testing; just hard-refresh.
- **CRLF warnings on Windows**: ignore. Git auto-converts.

---

## 9 — Things the owner has said they want eventually

(Capture from conversation; not committed work.)

- **Production visibility Phase 1+**: operation runs that post inventory
  transactions (consume inputs, produce outputs). Programs catalog
  (Phase 0) is done.
- Better procurement workflow on Trade items (POs, supplier prices)
- Production workflow on Make items (work orders, stages)
- More analytics on the dashboard (it's a placeholder right now)
- Per-user auth & per-role permissions (not even started)
- Mobile-friendly views (low priority)

When you tackle any of these, **see §0 for branch strategy.** All of
these would warrant a feature branch.

---

## 10 — Conventions for new files

- Server actions go under `src/lib/actions/<domain>.ts`. One file per
  domain, no monolithic `actions.ts`.
- Client components go under `src/components/<area>/<name>.tsx`.
- Shared types go in `src/lib/supabase/types.ts` if they mirror DB,
  otherwise next to the file that owns them.
- Use the `cn()` helper from `src/lib/utils.ts` for conditional classes.
- Inline comments should explain *why*, not what (the code says what).
- Co-author your commits as `Claude Opus 4.6 <noreply@anthropic.com>`
  in the trailer — the owner asked for this.

---

## Quick reference

| | Where |
|---|---|
| Add BOM section | `src/lib/bom/bom-sections.ts` |
| Programs CRUD | `src/lib/actions/operations.ts` |
| Add server action | `src/lib/actions/<domain>.ts` |
| Reusable UI primitive | `src/components/ui/` |
| Database state | Supabase MCP `execute_sql` / `list_tables` |
| Run migrations | Supabase MCP `apply_migration` |
| Read Postgres logs | Supabase MCP `get_logs(service: "postgres")` |
| Force cache wipe | empty commit + push |
| Type check | `npx tsc --noEmit` |
| Live URL | https://lt-factory-erp.netlify.app |
