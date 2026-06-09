# UX Overhaul Handoff — make the ERP magical

> Owner's brief, verbatim: *"Even now, the flow of work on it is a little broken and
> inconvenient. If you try to understand how our team will actually use this product,
> you might be able to make the UI and UX magical."*

Read `CLAUDE.md` first — it is the deep technical reference (schema, conventions,
pitfalls, deploy process). This file is the **product/UX context** that CLAUDE.md
doesn't carry: who uses the app, for what, where it hurts, and what just changed.

---

## 1 — Mission

The app is functionally rich and (as of last night) fast. What it is NOT yet is
**task-shaped**. The sidebar is a list of nouns (Inventory, Jobs, Programs, MRP…),
but the team thinks in jobs-to-be-done ("what do I buy today?", "what does the
laser cut today?", "a truck leaves for site X at 3pm"). Your mission: study the
real workflows below, find the friction, and reshape the UI/UX around the work.
Propose a vision + prioritized plan FIRST (plan mode), align with the owner, then
ship incrementally.

## 2 — The people and their daily work

The team is factory staff in India — **not tech-savvy**; up to ~15 concurrent
users; all on the live Netlify app (no auth yet, everyone sees everything).
Personas inferred from build sessions with the owner:

| Persona | Daily job | Surfaces today |
|---|---|---|
| **Owner/GM** | Oversees everything; reviews MRP; drives product changes | All pages |
| **Office coordinator** | A lift is sold → create the **job order**: spec, GAD drawing, BOM section-by-section, dispatch dates | `/jobs/new`, `/jobs/[id]/edit` |
| **Procurement** | "What must I buy before \<date\>?" | `/mrp` Trade tab + date cutoff |
| **Production planner** | "What do we manufacture, on which programs?" | `/mrp` Make tab, `/mrp/make-plan` (programs to run), `/mrp/plan` (raw-material buy list) |
| **CNC programmer** | Maintains the Programs catalog (nests), audits them, attaches sketches | `/programs` |
| **Store keeper** | Receives purchases, adjusts stock, marks **dispatches** when a truck leaves | `/inventory` stock adjust, job detail → Dispatch modal, `/inventory/changes` |
| **Cabin division** | Separate panel business: cabin SKUs by type/finish + light cabin job orders | `/cabin-inventory`, `/cabin-jobs` |

Core flows to design for (today each requires knowing which page + which filters):
1. **New sale → job order** (long form: details, spec, BOM phases, drawing, save-per-phase)
2. **Morning procurement**: MRP → Trade tab → cutoff date → buy list (POs are a future want)
3. **Plan production**: Make shortfall → which audited programs to run → raw material
4. **Dispatch a truck**: job → Mark dispatched → scope (1st/2nd phase) → quantities
5. **Stock truth**: search item → adjust stock → audit trail in Daily Changes
6. **Data hygiene**: unmatched BOM lines, programs "needs item", blocked make-plan items — scattered across pages

## 3 — State of the product (post perf-overhaul, 2026-06-10)

Last night's overhaul (all shipped to `main`, live, adversarially reviewed):
- **/inventory**: server-side pagination/search/sort via one Postgres RPC
  (`search_inventory`) — ~50 rows/page instead of ~2,400 items; trgm indexes.
- **/cabin-inventory/[id]**: same pattern via `search_cabin_type` (types hold 2–4k items).
- **/programs**: light cached list (under the 2MB cache cap) + server text search
  via `search_operations` RPC; all 1,041 programs now listed (1000-cap bug fixed).
- **MRP/plans**: independent reads parallelized + memoized — same outputs, much faster.
- **Realtime**: `items` + `inventory` published; `useRealtimeRefresh` hook
  (`src/lib/realtime/use-realtime-refresh.ts`, fail-safe) wired into inventory +
  cabin lists → they auto-refresh when another user changes items/stock.
- Hardening from reviews: request-id guards on async list fetches, snap-to-page-1
  on empty pages, cabin-scope preserved in pickers, `is_active` on edit deep-links.

Freshness model: paginated list queries are live (uncached); first-page/list caches
are tag-invalidated by in-app mutations; MRP/plan caches are 1800s + tag-invalidated.
Only out-of-band SQL edits need the empty-commit cache wipe (CLAUDE.md §7).

**Parked, not merged**: branch `feature/perf-mumbai` (Vercel region pin + direct
browser→storage uploads). The direct-upload part works on Netlify too and is a nice
small win if uploads ever feel slow. The Vercel/Mumbai move was consciously dropped.
**Not yet done**: realtime push on jobs/dispatch/programs surfaces; Supabase Pro
upgrade; MRP-as-single-RPC; the two-browser realtime test hasn't been human-verified.

## 4 — Known friction (the gold — start here)

Observed across build sessions; the owner has felt all of these:
- **No "start here"**: the dashboard (`/`) is hardcoded placeholder data. There is
  no morning briefing — no "X jobs due to dispatch this week, Y items short, Z
  programs pending audit". The realtime + fast-RPC foundations now exist to power one.
- **Pages, not tasks**: every flow starts by picking the right noun from a growing
  sidebar (11+ entries) and re-applying filters. No global search/command palette —
  the server RPCs (`search_inventory`, `search_operations`) make one cheap to build.
- **The job form is cognitively heavy**: many BOM sections by phase, three save
  buttons (Save Details / Save Phase / Save All), a required-field banner gating
  saves. Functional but intimidating. (See LOCKED constraint below before touching.)
- **Dense report pages**: MRP / make-plan / plan tabs+filters+cards are powerful but
  read like spreadsheets; owner repeatedly needed explanations ("why is this program
  listed?") — the fix that worked was making the display tell the story (true outputs,
  "goes into ___"). More of that honesty/narrative everywhere.
- **Date-cutoff UX** on MRP was reworked once and is still "not clean and intuitive"
  per the owner.
- **Data-hygiene debt is invisible**: unmatched BOM lines, "needs item" outputs,
  stub parts lists, blocked items — each lives on a different page with no unified
  "fix-it" queue.
- **Save/feedback patterns vary** page to page (some optimistic, some full refresh;
  deploys rotate action hashes → long-open tabs hit the StaleDeployGuard reload toast).
- **No roles**: everyone sees everything. Even without auth, a "view as: procurement /
  production / store" lens could declutter dramatically. (Real auth is a future want.)
- Mobile is poor (owner says low priority — but store/dispatch happens on the floor).

## 5 — Hard constraints (do not violate)

- **LOCKED: the job creation/upload flow** — job form save semantics,
  `createJob`/`updateJob`/`createJobWithBom`/`updateJobWithBom`, Excel job import.
  UI polish around it is fine; changing its behavior needs explicit owner approval.
- DB category typos (`Pannel`, `Miscallaneous`, `Thimbel`, `Pully`) are intentional.
- Cabin items stay OUT of main `/inventory` (own section); BOM section bindings
  depend on exact category paths.
- Don't reintroduce ship-everything lists — reuse the server pagination/search
  patterns (`getInventoryPage` et al.) for any new list UI.
- Keep the `seedRow = useMemo(...)` quirk in `ItemPickerSection` (CLAUDE.md §8).
- Workflow per change: read → edit → `npx tsc --noEmit` → `npm run build` →
  commit (co-author trailer per CLAUDE.md §10) → push `main` → tell the owner
  what/where/when. Netlify branch previews are OFF; big/risky work goes on a
  feature branch (CLAUDE.md §0 rubric) — or ask the owner to enable Deploy Previews.
- Local dev under OneDrive is flaky — verify on the live deploy (WebFetch or the
  preview/browser tools). SQL-first test any new Postgres function via Supabase MCP
  before wiring UI (this caught real bugs repeatedly).

## 6 — How to work with the owner

Non-developer, iterates fast, trusts you with technical calls, reviews the
**deployed app** not code. Explain changes in plain language (which page, which
button), announce deploy ETAs (~1–2 min) and hard-refresh needs, preview-count any
destructive SQL, surface trade-offs honestly. They respond very well to being shown
the *why* (e.g. the "goes into ___" fix) and to decisive recommendations with one
clear question when a real fork exists.

## 7 — Suggested first moves (not binding)

1. Walk the live app (https://lt-factory-erp.netlify.app) persona by persona; map
   each flow's click-path and note every spot requiring tribal knowledge.
2. Draft a UX vision: information architecture (task-first nav), a real dashboard,
   global search, consistent feedback/loading/save language, role lenses.
3. Review the plan with the owner (plan mode → ExitPlanMode), then ship in small
   verified increments, highest-friction first.
