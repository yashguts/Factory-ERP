# Inventory Flow — Session Handoff

**Goal (owner's words):** *"Make inventory on the ERP absolutely perfect. Going
forward (entries from tomorrow) I will be able to track every change
personally."* The owner is **confused about how the end-to-end flow fits
together** and wants to solve it **methodically**, one stage at a time — not a
big-bang rewrite.

The flow to nail, in the owner's own sequence:

```
demand → sub-assembly → (built-from + assembled-from) → program runs
       → inventory updation → phantom-item inventory mgmt → trade MRP
```

This doc is the single source of truth for that work. Read it top to bottom
before touching anything. Nothing in here has been built yet — it is the map +
the open decisions.

---

## 0. How to work this (process the owner wants)

- **Methodical, stage by stage.** Confirm each stage's behaviour with the owner
  before moving to the next. The owner reviews the *deployed app*, not code.
- **"From tomorrow" = a cutover.** History is accepted as-is; the target is that
  every entry *after* the cutover is correct and personally trackable. Don't try
  to retrofit old history unless asked.
- **Business rules are locked** (see memory `feedback_ux_rules_locked`): dispatch,
  make/trade, etc. are presentation-confusing but semantically deliberate. Solve
  confusion by fixing the *model/UX*, and only change mutation semantics with
  explicit owner sign-off.
- Branch for anything behavioural (this whole initiative). Tell the owner when a
  change is on a branch vs live.

---

## 1. The single chokepoint (read this first)

**Every** stock change goes through one function:

- `recordTransaction(...)` — `src/lib/actions/inventory.ts:1438`.
  It inserts one `inventory_transactions` row **and** updates the `inventory`
  balance (one row per item+warehouse). It also stamps `created_by_name` (the
  operator, from a cookie via `use-operator` — there is **no login**).

Two warehouses matter:
- **Raw Material Store** — sheets / purchased inputs.
- **Main Store** — everything produced or received.

Sign convention inside `recordTransaction`:
- Outbound (subtracts): `production_out`, `scrap`, `dispatch_out`.
- `adjustment`: **signed** (caller passes ±).
- Everything else inbound (adds): `production_in`, `purchase_in`, `transfer`.

**Live transaction types today** (from `inventory_transactions`, 2026-06-30):
| type | reference_type | meaning |
|---|---|---|
| `production_out` | null / `program_run` | sheets consumed by a program run (null = old seed) |
| `production_in` | `program_run` | component parts produced by a program run |
| `dispatch_out` | `dispatch` | stock shipped on a job dispatch |
| `purchase_in` | null / `po_receipt` | PO goods received (null = old seed) |
| `adjustment` | `import`/null/`program_run`/`txn_reversal`/`dispatch_undo`/`po_receipt_undo` | manual adjusts, imports, and all the undo/reversal paths |

**Idempotency pattern (important, reused everywhere):** each posting flow keys
its transactions by `reference_type` + `reference_id` (the run id / dispatch id /
receipt id). Re-posting is a no-op; undo posts a compensating `adjustment`.
Copy this pattern for any new posting flow.

---

## 2. Stage-by-stage: what changes inventory, what doesn't, the gaps

### Stage A — Demand
- **What:** job BOM lines (`job_bom_lines`) + component-demand rules
  (`item_demand_rules`) + finish-resolved explode. Read by `getMrpData`
  (`mrp.ts`) and the plan builders.
- **Inventory effect:** NONE. Demand is planning-only.
- **Files:** `mrp.ts`, `make-plan-core.ts`, `production-plan.ts`.

### Stage B — Sub-assembly (definition) + Built-from / Assembled-from
- **What:** an item's parts list in `item_bom_lines` (parent → children).
  "Built from" = stocked sub-parts; "Assembly parts" = phantom loose parts.
  Editor is the item detail page (`/inventory/[id]`, `ItemDetailClient`);
  list at `/subassemblies`. Actions in `item-bom.ts`
  (`getItemBom`, `saveItemBom`, `getSubassemblies`).
- **Inventory effect:** NONE. Defining structure is pure metadata.
- **Just shipped (2026-06-30, on `main`):** subassembly integrity guards —
  a program can no longer output a *whole* sub-assembly as a finished part
  (blocked + RED-flagged); sub-assemblies whose make children lack a program are
  RED-flagged. See memory `project_subassembly_program_conflicts`. "True
  sub-assembly" = parent with ≥1 **make** child (glass-only door panels are NOT
  treated as assemblies).

### Stage C — Program Runs  ✅ CHANGES INVENTORY
- **What:** `/program-runs`; `operation-runs.ts` `syncRunInventory`.
- **Effect:** on record, **consumes inputs** (sheets → `production_out` from Raw
  Material Store) and **produces `component` outputs** (→ `production_in` to Main
  Store). Delta-based + idempotent by run id; count-edit posts an `adjustment`
  delta; delete restores (count 0).
- **Does NOT post:** `cut_part` (loose/phantom), `tooling`, `scrap`, and unmapped
  (no item) outputs. Only mapped inputs + `component` outputs move stock.
- **Gaps:** forward-only (runs before ~2026-06-15 never posted); best-effort
  (try/catch — a failed post logs to console, run still saves, stock silently
  unmoved); a count-edit only re-syncs if the run was already posted; no
  scrap/yield variance (assumes exact `qty_per_run × count`).

### Stage D — Assembled-from (building the sub-assembly)  ❌ NOT ON MAIN — THE BIG GAP
- **What SHOULD happen:** building a sub-assembly **consumes its cut pieces**
  (phantom children) and **produces the parent** into stock.
- **Reality on `main`:** nothing. The assembly-run flow exists ONLY on the
  unmerged branch **`feature/assembly-runs`** (migration 051 + `assembly-runs.ts`,
  Phase-1 backend done; UI + cutover-gated stocking + MRP netting TODO). See
  `docs/assembly-runs-handoff.md` and memory `project_assembly_runs`.
- **Why it's THE gap:** the chain is broken in the middle —
  ```
  sheets ─(run)─▶ cut pieces ─(ASSEMBLY: nothing)─▶ sub-assembly ─(dispatch)─▶ deducted
     ✅ consumed     ✅ produced        ❌                  ❌ never made        ✅ (→ negative)
  ```
  Cut `component` pieces pile up in Main Store and are never consumed; assembled
  items sit at zero and go negative when dispatched. **Removing the old (wrong)
  "program outputs the whole sub-assembly" shortcut (done 2026-06-30) made this
  gap fully visible — closing it needs the assembly-run flow.**

### Stage E — Inventory updation (manual)  ✅ CHANGES INVENTORY
- **What:** stock-adjust widget → `adjustment` (signed); Excel import →
  `adjustment`/`import`; change-log undo → `txn_reversal`. In `inventory.ts` /
  `inventory-changes.ts`.
- **Does NOT change stock:** editing master fields (name, category, cost,
  min-stock, Make/Trade) or soft-delete.
- **Gaps:** adjustments unrestricted (any qty, **can go negative**, no reason
  required, no approval); `recordTransaction` has **no guard** against stocking a
  `phantom`/`tooling` item.

### Stage F — Phantom-item inventory management  ❌ NEVER STOCKED (by design)
- **What:** phantom items (`stock_behaviour='phantom'`, code `LP-###`) are cut
  pieces, never stocked. Program runs skip their `cut_part` outputs; the
  consuming step (assembly, Stage D) isn't live.
- **Gaps:** no guard stops a manual adjust from stocking a phantom (footgun);
  loose-part WIP (cut-but-not-fitted) is invisible; assembly-run cutover
  deliberately has **no history retrofit**.

### Stage G — Trade MRP  (planning; nets against stock)
- **What:** `/mrp/trade` — what to **buy** (trade items + sheets), netted vs
  on-hand + `on_order`. Procurement receipts (`/procurement`) post
  `purchase_in`/`po_receipt` ✅ and set `cost_price` (latest-paid-wins); undo →
  `po_receipt_undo` (qty restored, cost NOT reverted).
- **Inventory effect:** MRP itself = none (planning). **Receiving** = the ✅.
- **Gaps:** receipts land in Main Store (no per-line destination); trade netting
  is only as good as on-hand accuracy — which depends on Stages C–F being right.

### Jobs Dispatching  ✅ CHANGES INVENTORY (deducts the literal item sent)
- `dispatch.ts` → `dispatch_out` per (item, warehouse); idempotent; undo →
  `dispatch_undo`. Does NOT explode into components — deducts exactly what's sent.
- **Gaps:** no negative-stock block (over-dispatch → negative); forward-only
  (~43 pre-2026-06-17 dispatches never posted); deducts finished items that
  Stage D never produced → negative.

---

## 3. The core problems to solve (prioritised)

1. **Close the assembly gap (Stage D).** Highest leverage — finishes the
   cut→assemble→dispatch chain. Base work exists on `feature/assembly-runs`.
2. **Guardrails on every posting path:** block negative stock (or explicitly
   allow with a flag), refuse phantom/tooling in `recordTransaction`, and make
   posting failures *loud* (no silent try/catch swallow) — Stages C, E, dispatch.
3. **A clean "from tomorrow" cutover:** decide opening balances (physical count
   vs trust current), then everything after is delta-tracked.
4. **"Track every change personally":** decide the shape (reviewable feed +
   daily digest vs approve-before-commit vs digest-only). A lot is already
   captured (`created_by_name`, Stock Ledger with source-doc + actor —
   `inventory.ts` `ItemLedger`); the missing piece is the owner-facing review
   surface and possibly a required reason on manual moves.

---

## 4. OPEN DECISIONS for the owner (resolve before building)

These were raised and the owner deferred — get answers first, in the owner's
own words rather than forced multiple-choice:

- **Opening baseline:** physical count → freeze tomorrow, or trust current
  system balances, or count key items only?
- **"Track every change personally" means:** a reviewable feed + daily digest
  (attributable, no bottleneck), or approve-before-commit (owner signs off), or
  a daily digest only?
- **Entry strictness:** hard guards (block negative, require operator + reason,
  surface failures) vs warn-but-allow?
- **Assembly gap now or later:** finish `feature/assembly-runs` as part of this,
  or lock guards + traceability first?

---

## 5. Key files & pointers

| Concern | Location |
|---|---|
| Stock chokepoint | `src/lib/actions/inventory.ts` (`recordTransaction` ~1438, `ItemLedger`) |
| Program-run posting | `src/lib/actions/operation-runs.ts` (`syncRunInventory`) |
| Dispatch posting | `src/lib/actions/dispatch.ts` |
| PO receipts | `src/lib/actions/procurement.ts` (~1148) |
| Sub-assembly parts list | `src/lib/actions/item-bom.ts`; UI `ItemDetailClient`, `/subassemblies` |
| Demand / MRP | `src/lib/actions/mrp.ts`, `make-plan-core.ts`, `production-plan.ts` |
| Manual adjust / changes | `src/lib/actions/inventory-changes.ts`, `/inventory/changes` |
| Assembly runs (WIP) | branch `feature/assembly-runs`; `docs/assembly-runs-handoff.md` |

**Relevant memory files:** `project_program_run_inventory`,
`project_inventory_movements`, `project_assembly_runs`,
`project_subassembly_program_conflicts`, `project_component_demand_rules`,
`project_mrp_make_trade_split`, `feedback_ux_rules_locked`,
`project_procurement_receipts`.

**Recently done (context):** subassembly integrity guards merged to `main`
2026-06-30; sidebar trimmed (Inventory Health + Settings nav removed — pages
still exist, reachable by URL).
