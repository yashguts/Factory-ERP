# Factory ERP — Session Handoff

## Infrastructure

| Service | Details |
|---------|---------|
| **GitHub** | https://github.com/yashguts/Factory-ERP.git (branch: `main`) |
| **Supabase** | Project ID: `qwzisnmueuqnzzokkpmn`, Region: `ap-south-1` |
| **Supabase URL** | https://qwzisnmueuqnzzokkpmn.supabase.co |
| **Netlify** | Site: `lt-factory-erp.netlify.app` |
| **Local project** | `C:\Users\yash_\OneDrive\Desktop\Factory ERP` |
| **Reference project** | `C:\Users\yash_\OneDrive\Desktop\ricardo-ops-temp\` (GitHub: yashguts/ricardo-ops-dashboard) |
| **Target List Excel** | `C:\Users\yash_\Downloads\Target List (5).xlsx` |
| **Door Panel Excel** | `C:\Users\yash_\OneDrive\Desktop\Door Panel Category.xlsx` |

### Environment Variables (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=https://qwzisnmueuqnzzokkpmn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<stored locally, not committed>
```

---

## Git State

**Latest commit:** `dbfc9ea` — "Fix bugs, port custom BOM editors, and add data scripts"

**Full commit history (9 commits):**
```
dbfc9ea Fix bugs, port custom BOM editors, and add data scripts
c028ca4 Add job creation form with BOM sections and gating
d9a2d77 Add Job Orders module: list, detail, Excel import wizard
4bde475 Improve inventory page: category filters, sorting, pagination
b3eb08d Add lookup_key column and fix AFF landing/car detection bug
4cd552b Fix inventory query hitting Supabase 1000-row default limit
4bd5efb Add inventory import pipeline and seed 1,468 items from Google Sheets
4b34c01 Wire up real Supabase CRUD and add Netlify deployment config
9332bd5 Initial project setup: Factory ERP for elevator manufacturing
```

**Pending push:** Commit `dbfc9ea` is 1 ahead of `origin/main`. Run `git push origin main` to sync.

**Untracked files (intentionally excluded):**
- `.claude/` — local Claude config directory
- `a_copy.xlsx` — temporary file, can be deleted

---

## Database Schema (Supabase)

### Tables & Row Counts
| Table | Rows | RLS | Notes |
|-------|------|-----|-------|
| items | 1,504 | Yes | 1,477 imported + 27 new door panel items |
| item_categories | 41 | Yes | 3-level hierarchy (top → category → sub-category) |
| units_of_measurement | 10 | Yes | pcs, m, kg, nos, set, etc. |
| warehouses | 3 | Yes | Only active ones shown |
| inventory | 440 | Yes | Stock levels per item per warehouse |
| inventory_transactions | 440 | Yes | Transaction history |
| jobs | 137 | Yes | Imported from Target List Excel |
| job_bom_headers | 137 | Yes | One per job, item_id is NULLABLE |
| job_bom_lines | 3,767 | Yes | Excel-imported BOM quantities |
| target_column_map | 360 | **NO** | Excel column → item mapping. RLS disabled — needs fixing |
| bom_headers | 0 | Yes | Template BOMs (unused so far) |
| bom_lines | 0 | Yes | Template BOM lines (unused) |

### Migrations Applied (4 total)
1. `001_initial_schema.sql` — Core tables (items, categories, warehouses, inventory, BOMs, jobs)
2. `002_import_subcategories.sql` — Sub-category support for item_categories
3. `003_jobs_target_import.sql` — Job metadata columns, target_column_map table, nullable job_bom_headers.item_id
4. `004_bom_denormalized_columns.sql` — category, variant, value_text, sort_order on job_bom_lines for BOM form data

### Important Schema Details
- **item_categories** has a self-referencing FK (`parent_id → id`). PostgREST queries on `items` MUST use the FK hint `!items_category_id_fkey` when joining to `item_categories` to avoid ambiguity.
- **job_bom_lines** stores TWO kinds of data:
  - **Excel-imported lines**: have `source_col_index` set (integer), `item_id` set, `category` is NULL
  - **Form-created lines**: have `category` + `variant` + `value_text` set, `source_col_index` is NULL
- The `updateJobWithBom` function deletes form lines (`source_col_index IS NULL`) before re-inserting, preserving Excel lines.

### RLS Configuration
All tables use RLS with permissive anon policies (no auth configured yet). The `target_column_map` table has RLS DISABLED — needs `ALTER TABLE public.target_column_map ENABLE ROW LEVEL SECURITY;` plus an anon SELECT policy.

---

## What's Working

### Pages (all verified in browser)
| Route | Status | Description |
|-------|--------|-------------|
| `/` | ✅ | Dashboard with summary cards (demo data) |
| `/inventory` | ✅ | 1,504 items with search, category filters (3-level), type filter, stock status, pagination |
| `/inventory/import` | ✅ | CSV/Google Sheets import wizard |
| `/bom` | ✅ | Template BOM editor (placeholder, no data) |
| `/jobs` | ✅ | 137 jobs with search, status/door-type/brand filters, progress bars, sorting |
| `/jobs/[id]` | ✅ | Job detail with metadata grid + BOM sections display |
| `/jobs/[id]/edit` | ✅ | Job edit form with BOM section editors |
| `/jobs/new` | ✅ | New job form with full BOM section editors |
| `/jobs/import` | ✅ | Excel import wizard (4-step: upload → column mapping → preview → execute) |
| `/mrp` | ✅ | Placeholder |
| `/settings` | ✅ | Placeholder |

### Features Implemented
- **Inventory CRUD** — add/edit items, stock adjustments, transaction recording
- **Excel import pipeline** — 137 jobs imported from Target List with 3,767 BOM line quantities
- **Column mapping** — 360 Excel columns mapped to ERP items (stored in `target_column_map`)
- **Job form with BOM sections** — 25+ BOM sections grouped by phase, with section gating based on drive type, door type, capacity
- **Custom BOM editors** — MainBracketEditor (12 types + combo groups), CounterBracketEditor (8 types), CarLandingDoorsEditor (fire-rated, car doors, landing doors)
- **3-level category hierarchy** — Inventory filter supports parent → child → grandchild categories

---

## Known Issues & Bugs Fixed This Session

### Fixed
1. **PostgREST FK ambiguity** — Added `!items_category_id_fkey` hint to inventory queries
2. **Inventory adjustment math** — Adjustments now use raw quantity (can be negative) instead of forcing `Math.abs()`
3. **updateJobWithBom delete filter** — Changed from `.not("category", "is", null)` (deleted Excel lines too) to `.is("source_col_index", null)` (only deletes form lines)
4. **3-level category tree** — Inventory filter now collects grandchildren for the sub-category dropdown

### Known Issues (Not Yet Fixed)
1. **target_column_map RLS** — Table has RLS disabled. Low priority since it's a mapping table, but should be enabled with a permissive anon policy.
2. **Dashboard shows demo data** — The dashboard cards (156 items, 12 BOMs, etc.) are hardcoded demo data, not live queries.
3. **Duplicate category names** — "Collapsible Gate", "BY Parting Door", "Belt Detector" each have parent AND child categories with the same name. Works but could confuse users.
4. **Empty/orphaned categories** — Old "Door Panels" parent (0 items after recategorization), "Machine Unit Belt", "Belt Detector" sub-categories may have 0 items.

---

## Pending Work (Priority Order)

### 1. Continue Inventory Recategorization
**Status:** 2 of ~10 categories done (Door Panels, Large Purchased Items)

The user wants to recategorize items "one by one" by providing updated Excel sheets. Remaining categories include but are not limited to:
- Machine components
- Electrical items
- Safety equipment
- Structural items
- Cabin/interior items

**Process:** User provides Excel with columns (item name, category, sub-category) → create sub-categories in DB → reassign items.

### 2. Port Remaining Custom BOM Editors
The reference project (`ricardo-ops-temp`) has more custom editors that haven't been ported yet:
- `SafetyEditor.tsx` — Safety gear configuration
- `MachineEditor.tsx` — Machine unit configuration
- `GovernorEditor.tsx` — Governor configuration
- `FillerWeightEditor.tsx` — Filler weight configuration
- `CabinItemsEditor.tsx` — Cabin interior configuration

These are in `C:\Users\yash_\OneDrive\Desktop\ricardo-ops-temp\src\components\` (or similar path in the reference repo).

### 3. BOM Completeness Gap
**Current:** 3,767 of ~4,857 non-zero Excel cells captured (77.2%), 0 quantity mismatches.

The 22.8% gap is from:
- Unmapped columns (Excel columns without matching ERP items)
- Missing items in the ERP that exist in Excel

**Resolution:** After all items are recategorized and any missing items are added, re-run the import to capture the remaining cells.

### 4. Wire Up Live Dashboard
Replace hardcoded demo data with real Supabase queries showing actual item counts, job counts, low stock alerts, and recent activity.

### 5. Deploy to Netlify
The latest commit needs to be pushed to GitHub (`git push origin main`), which triggers auto-deploy on Netlify. Env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) must be set in Netlify dashboard.

### 6. Authentication
No auth is configured yet. Supabase Auth needs to be set up with:
- Login/signup pages
- Protected routes
- RLS policies that check `auth.uid()`

---

## Key Files Reference

### Server Actions (data fetching)
| File | Functions |
|------|-----------|
| `src/lib/actions/inventory.ts` | getItems, getItemsWithStock, createItem, updateItem, recordTransaction, getCategories, getUnits, getWarehouses, getRecentTransactions |
| `src/lib/actions/jobs.ts` | getJobs, getJobDetail, createJob, createJobWithBom, updateJobWithBom, getJobBomSections, updateJob |
| `src/lib/actions/jobs-import.ts` | resolveColumns, executeJobImport |

### BOM System
| File | Purpose |
|------|---------|
| `src/lib/bom/bom-sections.ts` | 25+ BOM section definitions with phases, gating rules, custom editor routing |
| `src/lib/bom/section-gating.ts` | Drive type, door type, capacity gating logic |
| `src/components/jobs/job-form.tsx` | Main job creation/edit form, routes sections to editors |
| `src/components/jobs/main-bracket-editor.tsx` | Main bracket: 12 types + combination groups, 1-4 rows |
| `src/components/jobs/counter-bracket-editor.tsx` | Counter bracket: 8 types, 1-4 rows |
| `src/components/jobs/car-landing-doors-editor.tsx` | Car + landing door configuration |

### Data Scripts (run with `node scripts/<name>.js`)
| Script | Purpose |
|--------|---------|
| `scripts/full-bom-import.js` | Import jobs + BOM from Target List Excel |
| `scripts/save-column-map.js` | Persist Excel column → item mapping to DB |
| `scripts/verify-bom-completeness.js` | Compare Excel data vs DB, report gaps |
| `scripts/recategorize-door-panels.js` | Reassign door panel items to new sub-categories |
| `scripts/debug-excel.js` | Debug Excel parsing issues |

---

## Commands Quick Reference

```bash
# Development
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build
npm run lint         # ESLint check

# Git
git push origin main # Push latest commit to GitHub (triggers Netlify deploy)

# Supabase (via MCP or Dashboard)
# Project: qwzisnmueuqnzzokkpmn
# Dashboard: https://supabase.com/dashboard/project/qwzisnmueuqnzzokkpmn

# Data scripts (need SUPABASE_URL and SUPABASE_KEY env vars or hardcoded)
node scripts/verify-bom-completeness.js
node scripts/full-bom-import.js
```
