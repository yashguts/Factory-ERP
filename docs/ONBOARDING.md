# Factory ERP — Developer Onboarding Guide

> **Who this is for:** a developer who is **brand new** to this project and wants
> to understand what it is, how it's built, and how to start making changes
> safely. It assumes you know JavaScript/React basics but nothing about this
> codebase, Next.js App Router, or Supabase.
>
> **How this differs from the other docs:**
> - [`CLAUDE.md`](../CLAUDE.md) — the reference manual (every table, every
>   convention). Dense; written for someone already oriented. Read it *after* this.
> - [`HANDOFF.md`](../HANDOFF.md) — a point-in-time status snapshot (somewhat stale).
> - [`docs/production-visibility-roadmap.md`](./production-visibility-roadmap.md) —
>   the long-term vision for the production/manufacturing layer.
> - **This file** — the "explain it to me from zero" guide. Start here.

---

## Table of contents

1. [What is this product?](#1--what-is-this-product)
2. [The 10-minute mental model](#2--the-10-minute-mental-model)
3. [Tech stack & how the pieces connect](#3--tech-stack--how-the-pieces-connect)
4. [Getting it running locally](#4--getting-it-running-locally)
5. [How a page works end-to-end (the request lifecycle)](#5--how-a-page-works-end-to-end-the-request-lifecycle)
6. [The data model, explained](#6--the-data-model-explained)
7. [The core domain concepts](#7--the-core-domain-concepts)
8. [A guided tour of every screen](#8--a-guided-tour-of-every-screen)
9. [Where everything lives (file map)](#9--where-everything-lives-file-map)
10. [Conventions you must follow](#10--conventions-you-must-follow)
11. [Worked examples: making common changes](#11--worked-examples-making-common-changes)
12. [Pitfalls & gotchas](#12--pitfalls--gotchas)
13. [Current state of the live database](#13--current-state-of-the-live-database)
14. [Glossary](#14--glossary)

---

## 1 — What is this product?

**Factory ERP** is an internal web application for an **elevator-manufacturing
business in India**. ("ERP" = Enterprise Resource Planning — software that tracks
the materials, orders and production of a manufacturing company.)

The business builds **custom elevators**. Every order ("job") is bespoke — a
different building, height, capacity, door style, finish. There is no fixed
product catalog you can just pull off a shelf; each elevator is assembled from
hundreds of parts, some bought from suppliers and some manufactured in-house on
CNC machines.

The app exists to answer questions the owner currently can only answer by asking
people who "have the information in their heads":

- **What do we have in stock?** → the **Inventory** module.
- **What does this specific elevator order need?** → the **Jobs / BOM** module.
  (BOM = "Bill of Materials" = the parts list for one product.)
- **Across all our open orders, what do we need to buy or make, and how much?**
  → the **MRP** module. (MRP = "Material Requirements Planning".)
- **How do we actually manufacture the in-house parts?** → the **Programs**
  module (the CNC cutting "recipes").
- **What has been shipped to site for each order?** → the **Dispatch** feature.

It is used by the **owner** (who is *not* a developer) and the factory team. The
owner iterates quickly and reviews the **deployed app**, not the code.

> **Key business reality to internalize:** this factory's unit of production is
> the **CNC program run**, not the individual part. One run of a cutting program
> produces *many* different parts at once from a single steel sheet (a "nest").
> The whole data model around "Programs" exists to model this honestly. See
> [§7](#7--the-core-domain-concepts) and the
> [roadmap](./production-visibility-roadmap.md).

---

## 2 — The 10-minute mental model

If you remember only one diagram, make it this one — it shows how an elevator
order flows through the system:

```
  A CUSTOMER ORDER ("Job")
        │
        │  has an elevator spec (floors, drive type, capacity, door type…)
        ▼
  A BILL OF MATERIALS  (job_bom_lines)
        │  ~25 "sections" (RAIL, MAIN BRACKET, Car Door Panel, Machine, …)
        │  each section = a list of inventory ITEMS + required quantities
        ▼
  Every Item is either:
        ├── TRADE  → bought from a supplier        ─┐
        └── MAKE   → manufactured in-house          │
                       │                            │
                       │ made via a CNC "Program"   │
                       │ (consumes raw steel,       │
                       │  produces many parts)       │
                       ▼                            ▼
        ════════════════════════════════════════════════
          MRP  =  add up what ALL open jobs need,
                  subtract what's in stock,
                  split into "buy this" vs "make this"
        ════════════════════════════════════════════════
                       │
                       ▼
          DISPATCH  =  record what physically shipped to each
                       site, in two phases (early vs late delivery)
```

Three things to hold in your head:

1. **Items are the atoms.** Everything (inventory, BOMs, programs, MRP) ultimately
   points at rows in the `items` table — every SKU, raw material, and part.
2. **A Job is a customer order + its parts list.** The parts list is built from
   predefined "BOM sections" that mirror how the factory thinks about an elevator.
3. **MRP and the Production Plan are *computed*, not stored.** They read jobs,
   BOMs, stock and programs on the fly and roll them up.

---

## 3 — Tech stack & how the pieces connect

| Layer | Technology | What it does here |
|---|---|---|
| **Framework** | **Next.js 15** (App Router) + **React 19** + **TypeScript** | The whole app — both server-rendered pages and client interactivity. |
| **Styling** | **Tailwind CSS v4** + CSS variables in `globals.css` | All styling is utility classes; theme colors are CSS vars like `var(--primary)`. |
| **Icons** | **lucide-react** | The sidebar/button icons. |
| **Database** | **Supabase** (hosted PostgreSQL) | All data. Project name "Factory ERP", id `qwzisnmueuqnzzokkpmn`, region `ap-south-1`. |
| **File storage** | **Supabase Storage** | Two buckets: `gad-drawings` (one drawing per job) and `program-sketches` (one sketch per program). |
| **Spreadsheets** | **xlsx** (SheetJS) | Excel import of items and jobs. |
| **Hosting** | **Netlify** | Auto-deploys on every push to `main`. Live at https://lt-factory-erp.netlify.app |

### How they connect (the big picture)

```
  Browser  ──►  Netlify (runs the Next.js app)  ──►  Supabase Postgres + Storage
                      │                                        ▲
                      │  Server Components render HTML          │
                      │  Server Actions run mutations  ─────────┘
                      ▼
              React Client Components (interactivity in the browser)
```

- **Next.js runs on Netlify.** When you push to `main`, Netlify rebuilds and
  redeploys in ~1 minute.
- **Supabase is just Postgres** with an auto-generated REST API (PostgREST) and a
  JS client. The app talks to it from the *server side* using the Supabase JS
  client.
- **There is no separate backend.** Next.js *is* the backend. Data fetching and
  mutations happen in **Server Components** and **Server Actions** (explained in
  [§5](#5--how-a-page-works-end-to-end-the-request-lifecycle)).

### ⚠️ Authentication is NOT wired up yet

This is the single most important thing to know about the current security model:

- There is **no login**. Anyone with the URL can use the app.
- Every database call uses the Supabase **anon key**.
- Row-Level Security (RLS) policies exist but are **permissive** (they allow the
  anonymous role to do everything).

This is a deliberate, known state — see CLAUDE.md §1 and the "things the owner
wants eventually" list. When auth is added later, the caching strategy will need
revisiting. **Don't assume any access control exists today.**

> There are **two** Supabase projects in this organization: **"Factory ERP"**
> (`qwzisnmueuqnzzokkpmn`) — the one this app uses — and **"Ricardo Elevators"**
> (`xatfjvaretgnrbmffqgx`), a related/reference project. Make sure you're always
> pointed at *Factory ERP*.

---

## 4 — Getting it running locally

### Prerequisites
- **Node.js 20** (Netlify builds on Node 20 — match it to avoid surprises).
- npm (comes with Node).
- Git.

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
#    Copy the example and fill in the real Supabase values.
cp .env.local.example .env.local
```

Your `.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=https://qwzisnmueuqnzzokkpmn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key — get it from the Supabase dashboard
                                or from the owner; it is NOT committed to git>
```

> Get the anon key from the Supabase dashboard → Project Settings → API, or ask
> the owner. **Never commit it** (it's gitignored, but be careful).

```bash
# 3. Run the dev server
npm run dev          # → http://localhost:3000

# 4. Before committing ANY change, type-check:
npx tsc --noEmit     # must come back clean — this is the fastest validation

# 5. Production build (same one Netlify runs) — run if you changed anything structural
npm run build
```

### ⚠️ Local dev hits the **live production database**

Because there's only one Supabase project configured, `npm run dev` reads and
writes the **real production data**. Be careful:
- Reads are safe.
- **Writes are real** — adding/editing/deleting items, jobs, etc. affects the
  live app the owner uses.
- For risky experiments, prefer the Supabase MCP tools / SQL with a
  count-or-preview first, or ask before mutating bulk data.

---

## 5 — How a page works end-to-end (the request lifecycle)

This is the most important section for understanding the code. Next.js App Router
has two kinds of components and a special way to mutate data. Once this clicks,
the whole codebase reads easily.

### Server Components vs Client Components

- **Server Components** (the default — no `"use client"` at the top) run on the
  server. They can `await` data directly and never ship their code to the browser.
  In this project, **every `page.tsx` is a Server Component** whose only job is to
  *fetch data and hand it to a client component*.

- **Client Components** (marked `"use client"` at the top) run in the browser.
  They have state, event handlers, `useState`, etc. In this project, **every
  interactive screen is a `*-client.tsx` component**.

The repeating pattern across the entire app:

```
page.tsx  (Server Component)              *-client.tsx  (Client Component)
─────────────────────────────            ────────────────────────────────
fetch data with server actions   ──────► receives data as props
(getItemsWithStock(), etc.)              renders the interactive UI
                                         calls server actions on user action
```

**Real example** — the Inventory page ([`src/app/(app)/inventory/page.tsx`](../src/app/(app)/inventory/page.tsx)):

```tsx
// Server Component: just fetches and delegates.
export default async function InventoryPage({ searchParams }) {
  const [params, items, categories, units, warehouses] = await Promise.all([
    searchParams,
    getItemsWithStock(),   // ← a cached server action
    getCategories(),
    getUnits(),
    getWarehouses(),
  ]);
  return <InventoryClient initialItems={items} categories={categories} … />;
}
```

`InventoryClient` (a `"use client"` component) then handles search, filtering,
sorting, the Add/Edit modals, etc., in the browser.

### Server Actions (how data is read and written)

A **Server Action** is an `async` function in a file that starts with
`"use server"`. It runs on the server but can be *called from client components
like a normal function*. This is how the app reads and writes the database
without you ever writing a REST endpoint.

They all live under [`src/lib/actions/`](../src/lib/actions/), one file per domain
(`inventory.ts`, `jobs.ts`, `mrp.ts`, …). Two flavors:

**1. Read actions** — wrapped in `unstable_cache` for speed, using the
cookie-free `createCacheClient()`:

```ts
export const getItemsWithStock = unstable_cache(
  _getItemsWithStockUncached,        // the real function
  ["items-with-stock"],              // cache key
  { revalidate: 60, tags: ["items", "inventory-stock"] },  // 60s TTL + tags
);
```

**2. Mutation actions** — use the cookie-aware `createClient()` and must call
`revalidateTag()` to bust the relevant caches afterward:

```ts
export async function createItem(data): Promise<ItemSaveResult> {
  const supabase = await createClient();
  const { data: item, error } = await supabase.from("items").insert({…});
  if (error) return { ok: false, error: translateItemError(error) };  // ← see below
  revalidateTag("items");            // ← bust the cache so reads see the change
  return { ok: true, id: item.id, code };
}
```

### The caching model (why your change might "not show up")

There are **three** layers of caching. When data looks stale, it's one of these:

| Cache | Lives where | How it clears |
|---|---|---|
| **Browser Router Cache** | The user's browser | `router.refresh()` or a hard reload |
| **Next.js data cache** (`unstable_cache`) | The server | 60s TTL, **or** `revalidateTag(...)` on a mutation |
| **Netlify build cache** | Netlify | Only on redeploy (any push to `main`) |

**Rule of thumb:**
- Changed data *through the app's UI*? The mutation called `revalidateTag` → fine.
- Changed data *directly via SQL* (outside the app)? The cache won't know.
  Either wait 60s or push an **empty commit** to force a redeploy
  (`git commit --allow-empty -m "bust cache" && git push`).

### The three Supabase clients (don't mix them up)

| File | Function | Use it for |
|---|---|---|
| [`lib/supabase/server.ts`](../src/lib/supabase/server.ts) | `createClient()` | **Mutations** (cookie-aware SSR client). |
| [`lib/supabase/cache-client.ts`](../src/lib/supabase/cache-client.ts) | `createCacheClient()` | **Cached reads** inside `unstable_cache` (no cookies — required there). |
| [`lib/supabase/client.ts`](../src/lib/supabase/client.ts) | browser client | Rarely used. |

### Errors from server actions (an important quirk)

Next.js **strips thrown error messages** from server actions in production (you'd
just get a generic "An error occurred…"). So for **user-facing validation
errors**, actions **return a result object instead of throwing**:

```ts
export type ItemSaveResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string };
```

`translateItemError()` in `inventory.ts` turns Postgres error codes (`23505`
unique violation, `23503` FK violation, `23514` check violation) into friendly
messages like *"Item code "RM-007" already exists."* **Follow this pattern for any
new action that can fail validation.**

---

## 6 — The data model, explained

All tables live in Supabase. The TypeScript mirror of every table is in
[`src/lib/supabase/types.ts`](../src/lib/supabase/types.ts) — **this file is your
map of the database.** SQL migrations that built it are in
[`supabase/migrations/`](../supabase/migrations/) (numbered `001`…`014`).

Here's how the tables relate, grouped by purpose:

### Inventory (the foundation)

```
item_categories (hierarchical: parent_id → self)
      │  e.g. "Hardware" → "Bull Dog Clips"
      ▼
   items  ◄──────── units_of_measurement (pcs, m, kg, set…)
      │  every SKU / part / raw material
      ▼
  inventory (stock balance, one row per item × warehouse) ◄── warehouses
      │
      ▼
inventory_transactions (every stock movement: in / out / adjust)
```

- **`items`** is the central table. Key columns:
  - `code` (unique, e.g. `SA-HD-057`), `name` (the display name — see invariant
    below), `item_type`, `category_id`, `uom_id`, stock levels, `cost_price`.
  - `is_active` — soft-delete flag (hidden items still referenced by old BOMs stay).
  - `procurement_type` — `make` / `trade` / `null` (null = inherit from category).
  - `stock_behaviour` — `stocked` / `phantom` / `tooling` (for the production layer).
  - `family` / `finish` — group finish-variants of one part (e.g. an MS vs SS door).
  - `suppliers` — up to 5 names (only meaningful for Trade items).
- **`item_categories`** is a self-referencing tree (a category has a `parent_id`).
  Categories carry a default `procurement_type` that items inherit.
- **Name = lookup_key invariant:** `lookup_key` is a *legacy* column kept in sync
  with `name` on every write. **Display always reads `name`.** Never build UI that
  shows `lookup_key`.

### Jobs & their BOMs

```
   jobs  (one customer order: job_number, customer, spec, status, stage, dates)
      │
      ▼
job_bom_headers (exactly one per job)
      │
      ▼
job_bom_lines (the parts list: category=section name, item_id, required_quantity…)
```

- **`jobs`** — the order. Important columns: `job_number` (unique), `customer_name`,
  `location`, `status` (`new`/`in_production`/`hold`), `stage` &
  `requirement_stage` (`new`/`first_phase`/`full_material`),
  `requirement_dispatch_date` (drives the MRP cutoff), elevator spec (`floors`,
  `drive_type`, `capacity`), `structure_included`, and the GAD-drawing pointer.
  > Many columns on `jobs` (`door_finish`, `progress`, `planned_*`, `actual_*`,
  > `notes`, `door_type`…) are **legacy** — present in the DB so old data survives,
  > but not surfaced in the current form. Don't be surprised by them.
- **`job_bom_lines`** — each row is one part on one job. `category` holds the
  **section name** (e.g. `"MAIN BRACKET"`), `item_id` points to the chosen item,
  `required_quantity` is how many. (Old Excel-imported lines may have
  `source_col_index` set and `item_id` null — those are the "unmatched" lines.)

### Dispatch (what shipped)

```
job_dispatches (one per dated shipment: dispatch_date, phase_scope first/second/full)
      │
      ▼
job_dispatch_lines (what was actually sent: which BOM line, which item, qty)
```

Dispatch is **Phase 0 — it has NO inventory effect** (it doesn't deduct stock
yet). It just records shipments. "Remaining for a BOM line = required − Σ
dispatched". Recording a dispatch **advances the job's `stage`** (first →
`first_phase`; second/full → `full_material`).

### Programs / Operations (the production layer)

```
   operations (a CNC "program"/recipe: name, machine, family, audit status, sketch)
      │
      ├──► operation_inputs  (raw materials CONSUMED per run)
      │
      └──► operation_outputs (parts PRODUCED per run — many per run = the "nest")
                 each output has a role: component | cut_part | tooling | scrap
```

- **`operations`** = one CNC program (the code calls it "operation", the UI calls
  it "program"). `machine` is `cnc_laser` / `cnc_punch` / `assembly_fit` (active
  values). `audited_at` marks it as reviewed.
- **Inputs** are raw sheets/material. **Outputs** are the many parts that come out
  of one run. An output's `role` matters: only `component` outputs that aren't yet
  linked to an inventory item show the "needs item" gap badge.
- `item_id` on inputs/outputs can be **null** ("to be filled") — the original
  imported name is kept in `label` so it can be resolved later. This is deliberate
  (see "knowledge is in heads" in the roadmap).

### Multi-level assembly structure ("Built from")

```
item_bom_lines  (an assembly item's own parts list — recursive, multi-level)
      parent_item_id → child, with a finish_rule: inherit | pinned | neutral
```

This is how a sub-assembly item knows what *it* is built from — enabling the
**Production Plan** (`/mrp/plan`) to explode a job all the way down to raw steel.
The `finish_rule` resolves which finish-variant of a child to use:
- `neutral` — use this exact child item (no finish dimension).
- `inherit` — child takes the parent's finish (resolved via `family` + finish).
- `pinned` — child is fixed to `pinned_finish` (e.g. an MS bracket inside an SS door).

### Audit / history

- **`item_change_log`** — every item create/update/delete, with field-level
  before/after diffs. Powers **Daily Changes** + one-click undo.

### Legacy / mostly-unused

- **`bom_headers` / `bom_lines`** — an older *template* BOM concept, currently
  empty/unused. Don't build the production layer on these.
- **`target_column_map`** — Excel-column → item mapping from the original bulk
  import.

---

## 7 — The core domain concepts

These are the ideas the code assumes you understand. Read this before touching
jobs, MRP, or programs.

### Items: Make vs Trade ("procurement type")

Every item is effectively either:
- **Trade** — bought from a supplier (→ "To Procure" in MRP).
- **Make** — manufactured in-house (→ "To Manufacture" in MRP).

The **effective** value = `item.procurement_type ?? item.category.procurement_type`
(item override wins; otherwise inherit the category default). Most items inherit
from their category.

### BOM sections & phases (how a job's parts list is structured)

The job form doesn't show one giant list — it shows **~25 named sections** (RAIL,
MAIN BRACKET, Car Door Panel, Machine, Governor, …), grouped into **phases**
(Structural, Brackets, Door System, …). All of this is defined in **one file**:
[`src/lib/bom/bom-sections.ts`](../src/lib/bom/bom-sections.ts) — the **single
source of truth**.

Each section definition has:
- `category` — the display name *and* the value stored in `job_bom_lines.category`.
- `phase` — which phase card it appears under (order set by `PHASE_ORDER`).
- `gate` — whether it shows: `always`, or conditionally on door/drive type
  (e.g. MAIN BRACKET is hidden for hydraulic drives via `driveTypeExclude(["HYD"])`).
- `defaultItemCategories` — category **path strings** (e.g.
  `"Rail Bracket > Rail Bracket Main"`) that scope the item-search for that
  section. At search time these resolve to category IDs and expand to include all
  descendants (logic in [`categories.ts`](../src/lib/actions/categories.ts)).

Users can also add **ad-hoc sections** at runtime ("+ Add Section From
Inventory") for things not in the predefined list.

### Dispatch phases (a *different* notion of "phase")

Don't confuse the **form phase** (UI grouping) with the **dispatch phase**.
Elevators ship in two waves:
- **First phase** — early material installed during structural work (rails,
  brackets, door frame/sill, etc.). The exact set is `FIRST_PHASE_SECTIONS` in
  `bom-sections.ts`.
- **Second phase** — everything else (cabin, door panels, machine, finishing).

`dispatchPhaseOf(category)` classifies any saved line by its stored category name.

### MRP (Material Requirements Planning)

[`getMrpData()`](../src/lib/actions/mrp.ts) answers: *across all jobs, how much of
each item do we need, and do we have it?*

1. (Optional) filter to jobs with `requirement_dispatch_date <= cutoffDate`.
2. Sum `required_quantity` across all their `job_bom_lines`, grouped by item.
3. Join stock, compute `shortfall = max(0, required − stock)`.
4. Split into tabs by effective procurement type: **Trade · To Procure** /
   **Make · To Manufacture** / **All**.

### Production Plan (the deep explosion)

[`getProductionPlan()`](../src/lib/actions/mrp.ts) (`/mrp/plan`) goes further:
it **recursively explodes** each make-item through its parts list
(`item_bom_lines`, finish-resolved) and through the program that produces it,
all the way down to a **buy-list of raw steel + purchased parts**, netted against
stock. It also reports how many program **runs** are needed.
> ⚠️ It does **not** optimize sheet nesting — it rolls up whole runs, which is a
> conservative over-estimate. Treat it as a planning aid to validate by hand.

### Programs = the factory's real recipes

The atomic unit of in-house production is the **program run**, which produces
**many parts at once** (a "nest" on one steel sheet). This is why "Programs" is
its own module and why `operation_outputs` is one-to-many. The long-term plan
(logging actual runs, posting inventory transactions, shop-floor kanban) is laid
out in [`production-visibility-roadmap.md`](./production-visibility-roadmap.md).
**Today everything is "Phase 0" — catalog only, no inventory movement.**

---

## 8 — A guided tour of every screen

The sidebar ([`src/components/layout/sidebar.tsx`](../src/components/layout/sidebar.tsx))
lists the modules. Here's what each one does and where its code lives. (Route →
page file → main client component.)

| Sidebar item | Route | What you do there |
|---|---|---|
| **Dashboard** | `/` | Landing page. Currently mostly placeholders. |
| **Inventory** | `/inventory` | The item master. Search/filter/sort all SKUs; add, clone, edit, delete items; adjust stock; Excel import. |
| **Daily Changes** | `/inventory/changes` | Audit feed of item edits + stock moves by day, with per-entry undo and per-item history search. |
| **Sub-assemblies** | `/subassemblies` | Lists items that have a parts list ("Built from"); define new ones via search. |
| **Bill of Materials** | `/bom` | Placeholder (the *template* BOM concept; mostly unused). |
| **Programs** | `/programs` | The CNC program/recipe catalog. Add/clone/edit programs, mark audited, attach sketches. |
| **Job Orders** | `/jobs` | The list of customer orders. Create, edit, view, dispatch. The heart of the app. |
| **MRP** | `/mrp` | Computed buy/make requirements across all jobs. `/mrp/plan` is the raw-material explosion. |
| **Settings** | `/settings` | Placeholder. |

### The big ones, in more detail

**Inventory (`/inventory`)** — [`inventory-client.tsx`](../src/components/inventory/inventory-client.tsx)
- List with stock, Make/Trade badge, type, category, cost, status (OK/Low/Out).
- Multi-token fuzzy search; filters by type/category/sub-category/stock state.
- **Add / Clone / Edit** via a modal ([`item-form-modal.tsx`](../src/components/inventory/item-form-modal.tsx)).
  Clone auto-suggests the next code in the series.
- **Delete** is *smart*: hard-delete only if nothing references the item,
  otherwise soft-delete (`is_active=false`). See `deleteItem` in `inventory.ts`.
- **Stock adjust** inline + modal. Excel import at `/inventory/import`.
- **Item detail** (`/inventory/[id]`) — identity + the two parts sections
  ("Built from" stocked sub-parts and "Assembly parts" loose/phantom parts).

**Jobs (`/jobs`, `/jobs/new`, `/jobs/[id]`, `/jobs/[id]/edit`)**
- **List** ([`jobs-client.tsx`](../src/components/jobs/jobs-client.tsx)) — search +
  status/stage/drive filters; inline-edit status/stage/dispatch date; a Dispatch
  status badge per row.
- **New / Edit form** ([`job-form.tsx`](../src/components/jobs/job-form.tsx), the
  largest file — 893 lines) — Job Details + Elevator Spec panels, then the BOM by
  phase. Each phase is a card; each section is an item-picker. Three save buttons:
  - **Save Details** → `updateJob` (metadata only).
  - **Save Phase** → ensures the job exists, then `saveBomSection` for that phase's
    sections.
  - **Save All & Finish** → saves everything, then navigates to the job.
  > `saveBomSection` **deletes all existing lines in the affected sections and
  > re-inserts** — the picker is the source of truth. Required-field validation
  > gates the save buttons.
- **Detail** ([`job-detail-client.tsx`](../src/components/jobs/job-detail-client.tsx))
  — read-only BOM (section view / item view), drawing split-screen, and the
  **Dispatch panel** (per-phase status + dated history).
- **Dispatch** ([`dispatch-modal.tsx`](../src/components/jobs/dispatch-modal.tsx) +
  [`dispatch.ts`](../src/lib/actions/dispatch.ts)) — pick a date + scope, see
  Required · Sent · Left per item, record partial/over/ad-hoc shipments.

**MRP (`/mrp`)** — [`mrp-client.tsx`](../src/components/mrp/mrp-client.tsx)
- Three tabs (Trade/Make/All) with counts, a date-cutoff filter, summary cards,
  and a table (Code, Name, Type, Category, Required, In Stock, Shortfall, Jobs).
- Hover the **Jobs** cell → popover of which jobs need the item.
- `/mrp/plan` — the deep raw-material buy-list explosion.

**Programs (`/programs`, `/programs/[id]`)** — [`programs-client.tsx`](../src/components/programs/programs-client.tsx)
- List with machine/label/audit-status chip filters, an audit progress counter,
  and full add/clone/quick-edit/audit-toggle.
- Detail page shows Inputs and Outputs tables + a sketch panel.

---

## 9 — Where everything lives (file map)

```
Factory-ERP/
├── CLAUDE.md                  ← the dense reference manual (read after this)
├── HANDOFF.md                 ← older status snapshot
├── docs/
│   ├── ONBOARDING.md          ← THIS FILE
│   ├── production-visibility-roadmap.md
│   └── handoff-cnc-programs.md
├── package.json               ← scripts + dependencies
├── next.config.ts             ← Next.js config (50MB upload limit for drawings)
├── netlify.toml               ← Netlify build config (Node 20)
├── supabase/migrations/       ← SQL that built the DB (001…014, run in order)
├── scripts/                   ← one-off Node/Python data scripts (imports, fixups)
└── src/
    ├── app/
    │   ├── layout.tsx              ← root layout (+ StaleDeployGuard)
    │   ├── globals.css             ← Tailwind + CSS theme variables
    │   └── (app)/                  ← route group sharing the sidebar shell
    │       ├── layout.tsx          ← wraps pages in <AppShell>
    │       ├── page.tsx            ← Dashboard
    │       ├── inventory/…         ← inventory list, [id] detail, changes, import
    │       ├── jobs/…              ← list, new, [id], [id]/edit, import, unmatched
    │       ├── mrp/…               ← mrp + mrp/plan
    │       ├── programs/…          ← list + [id] detail
    │       ├── subassemblies/…
    │       ├── bom/  settings/     ← placeholders
    │       └── */loading.tsx       ← skeleton loaders
    ├── components/
    │   ├── ui/                     ← reusable primitives (Button, Input, Select,
    │   │                              Modal, Table, Badge, ConfirmDialog)
    │   ├── layout/                 ← AppShell, Sidebar, StaleDeployGuard
    │   ├── inventory/              ← inventory client, item form, stock adjust,
    │   │                              item detail, loose-part picker, daily changes
    │   ├── jobs/                   ← job form, detail, dispatch, BOM pickers, GAD panel
    │   ├── mrp/                    ← mrp table, jobs popover, production plan
    │   └── programs/               ← programs list, form, detail, sketch, line picker
    └── lib/
        ├── utils.ts                ← cn() classname helper
        ├── supabase/               ← server.ts, cache-client.ts, client.ts, types.ts
        ├── actions/                ← SERVER ACTIONS, one file per domain ★
        │     inventory.ts  jobs.ts  mrp.ts  dispatch.ts  operations.ts
        │     item-bom.ts  inventory-changes.ts  categories.ts  items.ts
        │     gad-drawings.ts  bom-mapping.ts  import.ts  jobs-import.ts
        ├── bom/                    ← bom-sections.ts ★ (sections) + section-gating.ts
        ├── inventory/              ← next-code.ts (auto code-series suggestion)
        └── import/                 ← Excel parsers + templates
```

★ = the files you'll touch most often. **`lib/supabase/types.ts`**,
**`lib/actions/`**, and **`lib/bom/bom-sections.ts`** are the spine of the app.

---

## 10 — Conventions you must follow

These come from CLAUDE.md and the existing code. Match them or you'll break things.

1. **Branch strategy** (the owner is not a developer and trusts you to decide):
   - Small fixes, copy tweaks, adding a column/button → commit straight to `main`.
   - Risky schema changes, big refactors (>10 files), or speculative work →
     **feature branch + tell the owner explicitly**. Default to merging via
     `git merge` once they confirm (they review the *deployed app*, not the code).
2. **Every change workflow:** read the files → edit → `npx tsc --noEmit` (clean) →
   commit (clear message) → push → **tell the owner in plain language what changed,
   which page/button it affects, and when it'll be live** (~1 min after push).
3. **Confirm destructive operations.** Always run a `count`/preview query before
   any `DELETE`/`UPDATE` touching more than one row.
4. **Server actions:** one file per domain under `lib/actions/`. Reads →
   `unstable_cache` + `createCacheClient()` + tags. Mutations → `createClient()` +
   `revalidateTag()`. Validation failures → **return** `{ok:false, error}`, don't
   throw.
5. **Display reads `items.name`, never `lookup_key`.** Keep them in sync (the
   helpers already do).
6. **BOM sections** are edited only in `bom-sections.ts`. Use the **exact** DB
   category names — *including the typos* (see pitfalls).
7. **New files:** client components → `components/<area>/<name>.tsx`; types that
   mirror the DB → `lib/supabase/types.ts`; use the `cn()` helper for conditional
   classes; comments explain *why*, not *what*.
8. **Commit trailer:** the owner asked for a co-author trailer on commits (see the
   examples in `git log`).

---

## 11 — Worked examples: making common changes

### Add a new field to jobs (e.g. a "site contact" field)

1. **SQL migration:** `ALTER TABLE jobs ADD COLUMN site_contact text;`
   (apply via the Supabase dashboard/MCP, and add a numbered file in
   `supabase/migrations/`).
2. **Type:** add `site_contact: string | null;` to the `Job` interface in
   [`types.ts`](../src/lib/supabase/types.ts).
3. **Form:** add the input to the relevant panel in
   [`job-form-panels.tsx`](../src/components/jobs/job-form-panels.tsx) and include
   it in `buildJobData()` in `job-form.tsx`.
4. **Actions:** widen the param types of `createJob` / `updateJob` /
   `createJobWithBom` / `updateJobWithBom` in [`jobs.ts`](../src/lib/actions/jobs.ts).
5. (Optional) show it on the detail meta strip in `job-detail-client.tsx`.
6. `npx tsc --noEmit`, commit, push, tell the owner.

### Add or re-point a BOM section

Edit only [`bom-sections.ts`](../src/lib/bom/bom-sections.ts). Add an entry to
`BOM_SECTIONS` (and to `PHASE_ORDER` if it's a new phase). Set
`defaultItemCategories` to real DB category paths. Done — the form picks it up.

### Bulk-fix data via SQL

Preview with a `SELECT count(*)` first → run the `UPDATE` → **push an empty commit**
to wipe the Netlify cache so users see fresh data immediately (otherwise they wait
~60s for the TTL).

### "Why isn't my change showing?"

Walk the three caches in [§5](#the-caching-model-why-your-change-might-not-show-up).
App-driven change → it revalidated. SQL-driven change → empty commit. User's stale
tab → hard refresh.

---

## 12 — Pitfalls & gotchas

- **The DB has intentional typos in category names** — `Pannel` (not Panel),
  `Miscallaneous`, `Thimbel`, `Pully`, `Bracket Trey`. **Do not "fix" them** —
  real data references these exact strings. Match them as-is when binding sections.
- **Categories named the same as their parent** are common (e.g.
  `By Parting Door > By Parting Door`). Don't normalize; bindings use the full path.
- **`door_type` on jobs is effectively dead** — the form field was removed; the
  column stays. The only door_type-adjacent live logic is the MAIN BRACKET gate.
- **PostgREST relation shape:** a "belongsTo" join may come back as `{...}` *or*
  `[{...}]` depending on the query planner. Use the `flatten<T>()` helper pattern
  (see `getJobBomItemLines` in `jobs.ts`) when reading joined relations.
- **Stale-deploy guard:** every redeploy changes server-action hashes, so a
  long-open browser tab can throw *"Server Action X was not found"*. The
  [`StaleDeployGuard`](../src/components/layout/stale-deploy-guard.tsx) catches
  this and prompts a reload — it's expected, just hard-refresh.
- **`useMemo` for seeded picker rows** in `ItemPickerSection` — keep
  `seedRow = useMemo(() => emptyRow(), [])`. Without it React remounts the input
  and steals focus. (A real bug that was fixed; don't reintroduce it.)
- **CRLF warnings on Windows** — harmless, ignore.
- **Local dev = live data** — see [§4](#4--getting-it-running-locally).

---

## 13 — Current state of the live database

Snapshot taken **2026-06-02** from the live "Factory ERP" Supabase project
(`qwzisnmueuqnzzokkpmn`). Use this to calibrate scale — these numbers grow.

| Table | Rows | Notes |
|---|---:|---|
| `items` | **2,290** | 2,288 active. The item master. |
| `item_categories` | **382** | 2–3 level deep tree. |
| `jobs` | **83** | Customer orders. |
| `job_bom_headers` | 83 | One per job. |
| `job_bom_lines` | **3,398** | The actual parts requirements. |
| `operations` (programs) | **984** | 47 audited so far. |
| `operation_outputs` | **2,279** | The many-parts-per-run nests. |
| `operation_inputs` | 984 | Raw materials per program. |
| `item_bom_lines` | **10** | Multi-level "Built from" — just starting to grow. |
| `inventory` | 1,484 | Stock balances (item × warehouse). |
| `inventory_transactions` | 1,121 | Stock movement history. |
| `item_change_log` | 40 | Audit trail (Daily Changes). |
| `job_dispatches` | **1** | Dispatch is brand-new / barely used yet. |
| `warehouses` | 3 | |
| `units_of_measurement` | 11 | |
| `bom_headers` / `bom_lines` | 0 / 0 | Legacy template BOMs — unused. |
| `target_column_map` | 363 | Excel-import column mapping. |

**What this tells you about where the project is:**
- Inventory and Jobs/BOM are **mature and populated** — real production data.
- The **Programs catalog is large** (984 programs) but **only ~5% audited** — a
  lot of cleanup/verification work remains there.
- The **multi-level assembly** (`item_bom_lines`, 10 rows) and **Dispatch**
  (1 record) features are **new and barely populated** — they'll be active areas.

---

## 14 — Glossary

| Term | Meaning |
|---|---|
| **ERP** | Enterprise Resource Planning — software tracking materials, orders, production. |
| **Item** | Any SKU in the `items` table — a part, raw material, or finished good. |
| **BOM** | Bill of Materials — the list of parts that make up one product/job. |
| **Job / Job Order** | One customer order for a custom elevator. |
| **Section** | A named group of BOM lines on a job (RAIL, MAIN BRACKET, …). Defined in `bom-sections.ts`. |
| **Phase (form)** | A grouping of sections in the job form (Structural, Door System, …). |
| **Phase (dispatch)** | Whether material ships early (first) or late (second). |
| **Make / Trade** | Whether an item is manufactured in-house (make) or bought (trade). |
| **MRP** | Material Requirements Planning — "what do all jobs need vs what we have." |
| **Program / Operation** | A CNC recipe. DB table = `operations`; UI label = "Program". |
| **Run** | One execution of a program; produces many parts (a "nest") at once. |
| **Nest** | The set of parts cut from one sheet in one program run. |
| **Phantom / loose part** | A part that's cut and fitted but never stocked on its own (`stock_behaviour='phantom'`). |
| **GAD drawing** | "General Arrangement Drawing" — the elevator drawing attached to a job. |
| **Server Component** | A React component that runs on the server and fetches data (default in App Router). |
| **Client Component** | A `"use client"` component that runs in the browser and handles interactivity. |
| **Server Action** | A server-side function (in a `"use server"` file) callable from the client; how the app reads/writes the DB. |
| **revalidateTag** | The Next.js call that busts a cached read after a mutation. |
| **Soft delete** | Hiding a row (`is_active=false`) instead of deleting it, to preserve references. |

---

## Where to go next

1. **Run it locally** ([§4](#4--getting-it-running-locally)) and click through every
   screen while watching the network tab — match what you see to
   [§8](#8--a-guided-tour-of-every-screen).
2. **Read one full vertical slice** end to end: `inventory/page.tsx` →
   `inventory-client.tsx` → `lib/actions/inventory.ts`. Once that clicks, every
   other module follows the same shape.
3. **Skim [`CLAUDE.md`](../CLAUDE.md)** for the exhaustive reference, and
   [`production-visibility-roadmap.md`](./production-visibility-roadmap.md) for
   where the manufacturing features are headed.
4. **Pick a small first task** (a copy tweak or a new column) and take it through
   the full workflow in [§11](#11--worked-examples-making-common-changes).

Welcome aboard. 🛗
