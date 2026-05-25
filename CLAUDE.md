# Factory ERP - Elevator Manufacturing

## Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS 4, custom CSS variables for theming
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth (to be configured)
- **Deployment**: Netlify

## Project Structure
```
src/
  app/
    (app)/           # Route group with sidebar layout
      inventory/     # Inventory management module
      bom/           # Bill of Materials module
      jobs/          # Job Orders module (placeholder)
      mrp/           # MRP module (placeholder)
      settings/      # Settings module (placeholder)
      layout.tsx     # App shell with sidebar
      page.tsx       # Dashboard
    layout.tsx       # Root layout
    globals.css      # CSS variables + Tailwind imports
  components/
    ui/              # Reusable UI components (Button, Input, Table, Modal, Select)
    layout/          # AppShell, Sidebar
    inventory/       # Inventory-specific components
  lib/
    utils.ts         # cn() utility for class merging
    supabase/
      client.ts      # Browser Supabase client
      server.ts      # Server-side Supabase client
      types.ts       # TypeScript types matching DB schema
supabase/
  migrations/        # SQL migration files
```

## Database Schema
Core tables: `items`, `item_categories`, `units_of_measurement`, `warehouses`, `inventory`, `inventory_transactions`, `bom_headers`, `bom_lines`, `jobs`, `job_bom_headers`, `job_bom_lines`

Key design decisions:
- Items have a `item_type` enum: raw_material | sub_assembly | finished_good
- BOMs are multi-level (recursive): a sub-assembly item can have its own BOM
- Job BOMs are editable snapshots of template BOMs (won't change when template changes)
- All monetary values in INR

## Commands
```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run lint     # ESLint
```

## Current State
- UI scaffolding complete with demo data
- Supabase not yet connected (needs .env.local with credentials)
- Inventory and BOM pages have demo data UI
- Jobs and MRP pages are placeholders
