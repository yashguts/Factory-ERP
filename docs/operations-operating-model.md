# Operations Operating Model — LT Elevator + Ricardo

*Prepared 2026-09-26. Every number in this document was queried live from the three
production databases (Factory ERP, Ricardo CRM, LT CRM) plus the lt-amc service
platform on this date. Method: 3 data-grounding analyses, 4 independent design
passes (process / automation / organisation / customer experience), 2 adversarial
critiques, then synthesis. This is the reference version; the chat summary is the
short version.*

---

## 0. Executive summary

The company does not have a manufacturing problem. It has a **coordination-layer
vacuum**: there are customer-getting roles (sales, 13 Ricardo city partners, 10 LT
BDMs) and metal-cutting roles (factory), and almost nothing in between. The entire
order-to-handover coordination function is one owner plus one heroic LT
coordinator (one LT user made **74% of all 4,479 stage moves** in the last 90
days). Every "pile" in the data is a queue nobody owns.

The fix is **not** a new software system and **not** a big ops department. It is:

1. **~12 dev-days of connecting software** on the existing stack (the audit found
   the ERP is ~80% built for this — signals just die at sidebar badges on a shared
   screen; nothing ever reaches a phone).
2. **3 serialized hires + 1 promotion** (₹1.3–1.7 lakh/month all-in): a Production
   Planner (the keystone), a Ricardo partner-desk coordinator, an
   installation/handover coordinator — and a real retention correction for the LT
   coordinator **before** any hire is announced.
3. **A small set of owned exception queues with SLAs**, delivered as WhatsApp
   digests, replacing the owner's all-day scanning with a 30–90 min/day exception
   review.
4. **One honest promise rule** (nothing promised under the realized median lead
   time without a logged owner override) and **one honest backlog split**
   (company-fault vs customer-fault lateness).

The hardest part is none of the above: it is that **the owner's own behaviour is
the project**. Every mechanism dies the first time the owner publicly overrides
the plan or answers the bypassed phone call. That is treated as explicit,
measured work in this plan (§9).

---

## 1. Diagnosis — what the live data says

### 1.1 The headline numbers (2026-09-26)

| Fact | Value |
|---|---|
| Active ERP jobs | 343 (190 Ricardo, 153 LT) — but ~95 are "ghosts" (fully dispatched, never closed) → true WIP ≈ 248 |
| Past required dispatch date | 132 (stage-based) / **212 on strict BOM-line coverage = 62% of the book** |
| Of the 132 overdue: payment state | **~30 (23%) are ≥75% paid = company-fault** · ~98 (74%) are BELOW the 75% dispatch gate = payment-gated · 4 unmatched |
| Paid ≥75%, not dispatched (both CRMs, all jobs) | **113 customers** (66 Ricardo — 53 of them ≥90% paid — + 47 LT). THE fire list. |
| Promised vs delivered lead time | Promise median **23.5 days**; delivery median **28** / p90 **76**. 29% of intake promised ≤14 days. Dates are set by hope. |
| Intake vs completion | ~44 jobs/month in, ~28/month reaching full coverage → **WIP grows ~15/month** and can never shrink (no terminal status exists) |
| "Urgent" set | 130 jobs (38% of the book), 43 stale, **misses 52 genuinely overdue jobs** — a dead signal |
| Jobs with no BOM at all | **67 active (20%)**, 61 of them Ricardo — invisible to MRP/dispatch/everything |
| Cabins finished, awaiting dispatch | **46**, median wait **34.6 days** (process median is 5.9 days when it runs) |
| Drawing info requests open (Ricardo) | **47**, median age **47 days** (close time is 1–3 days when touched) — named production blockers nobody chases |
| Ricardo New Orders untouched | **77 jobs, median 87 days**; 1 welcome call ever logged |
| Payments pending approval (Ricardo) | **129 payments, ₹2.96 cr, oldest 146 days** — every one stalls a dispatch decision under the 75% rule |
| LT dispatched-but-never-confirmed-delivered | **62 jobs** (median 65 days) — the post-dispatch black hole |
| Pre-dispatch contract value waiting | **~₹103 cr** across both CRMs |
| CRM lifecycle fields (prod checks, QC, packing, dispatch, delivery) | **0 rows, ever, in both CRMs** — the workflow exists in software and is 100% dead |
| GAD drawing adoption in ERP | **98.8%** — proof the team WILL feed a system when the workflow gates on it |

### 1.2 The four root causes

1. **Promises are fiction.** No capacity or payment check at date entry; the
   promise curve sits left of the delivery curve, so lateness is mathematically
   guaranteed and compounds weekly.
2. **Nothing ever finishes.** No terminal job status (ERP: new/in_production/hold
   only). Jobs, POs, holds, urgent-list members — everything checks in and never
   checks out, so every list is polluted and nobody trusts any of them.
3. **Priority is oral tradition.** The CRM stage dropdown + ~400 free-text notes a
   month + one person's memory ARE the coordination system. The owner is the
   database.
4. **The overdue book mixes two different problems.** ~¾ of "overdue" jobs are
   payment-gated (customer's ball), ~¼ are company breaches (paid customers
   waiting). One number blends them, so the number means nothing and the team
   ignores it.

### 1.3 What is NOT broken (don't spend money here)

- Procurement: PO cycle median 12 days. Fine.
- Drawings capture: 98.8%. Fine.
- Machine capacity: program runs FELL ~38% while the late pile grew — the factory
  is waiting on decisions, not the reverse. (Verify with machine-hours before any
  blitz, but capacity is not the first constraint.)
- The CRMs and ERP themselves: the software is rich. The problem is that nothing
  connects the systems' facts to a human with a queue and an SLA.

---

## 2. Design principles (each forced by the data)

1. **Events, not forms.** Every factory-facing CRM field has 0% adoption; every
   gated workflow (GAD) has ~99%. New facts must be stamped as side effects of
   actions people already do — never new form-filling.
2. **Queues, not dashboards.** The views mostly exist. Signals must reach a phone
   (WhatsApp), be owned by exactly one person, and carry an SLA.
3. **Self-resolving lists.** The Urgent set died because membership was manual.
   Every list must compute its own membership and evict itself.
4. **One master per fact.** CRM = customer, money, drawings, stages. ERP =
   material, production, dispatch, promise date. Mirrors are read-only; the
   bridge (already proven) syncs events.
5. **Gate, don't police.** Data hygiene comes from workflow gates (no BOM → not
   schedulable) — never from someone checking screens.
6. **Whose ball is it.** Every late job is either company-fault or
   customer-fault (payment / site / drawing approval). The clock pauses when the
   ball is with the customer. All metrics respect this split.
7. **Trust is spent once.** Every automated state change runs report-only for
   3–4 weeks with human confirmation before it acts. One mis-closed job or stale
   digest and the whole apparatus gets the Urgent-list death: polite ignoring.

---

## 3. The backlog, re-segmented (do this before anything else)

The 132 "overdue" jobs are four different problems:

| Segment | Count | Whose ball | Action |
|---|---|---|---|
| **Company breach** — ≥75% paid, not dispatched | ~30 (fire list core; 113 across all jobs) | Ours | Sequence first in the plan; personal call + honest re-promise; dispatch in tranches (~15/week so normal demand doesn't silently slip) |
| **Payment-gated** — below 75% | ~98 | Customer's | NOT a manufacturing campaign. A collections/communication campaign: "material ready when you are" framing, clock marked `paused:payment`. Removing these from "overdue" makes the ops metric honest overnight |
| **Intake debt** — no BOM at all | 67 active (24 of the overdue) | Ours (office) | BOM backfill by **Planner + design engineers with the AI predictor** — NOT coordinators. Wrong BOMs poison MRP silently. 6–8/week is fine |
| **Data debt** — unmatchable job keys | 4 (RNLMALS-*, BBSR-314) | Ours (data) | Fix the keys or flag permanently; unmatched-% becomes a standing health metric |

Also in week 1–2: close the **95 ghost jobs** (terminal status + one supervised
sweep). Active book drops 343 → ~248 by bookkeeping alone; every downstream list
and meeting instantly gets cleaner.

**Before the dispatch blitz:** join the 46 ready cabins and the fire list against
paid% — do not build/ship for customers below the gate (that converts scarce
working capital into unpaid finished goods). Add a production-release payment
floor: release to factory requires the drawing-approval milestone actually
received (~46% cumulative) or a logged owner override.

---

## 4. The operating model — gates, queues, rituals

### 4.1 The promise rule (one rule, not a scheduling system)

- `requirement_dispatch_date` becomes a **commitment**, set only when the job is
  released to the factory (BOM complete + audited), never at order entry.
- **Floor rule:** nothing is promised under the realized median lead (currently
  28 days) without a logged owner override. A soft warning shows the load of the
  chosen week ("this week already has N jobs due"). The full slot-calendar is
  deferred — earn it later.
- Customers hear **week-ranges, never dates** ("dispatch in the week of 12 Oct").
- Date changes are legal but logged with a reason; the 3rd change on a job is an
  owner-level exception.
- Re-promise **before** the date passes (T−7 forecast), never after.
- `requirement_stage` gets set deliberately at release (first-phase vs full) —
  today 95% of jobs say "everything, now", which is how a 130-job urgent list
  happens.

### 4.2 The six launch queues (not twelve — add one only when an existing one is being cleared to SLA)

| # | Queue | Today | Owner | SLA |
|---|---|---|---|---|
| 1 | Paid ≥75%, not dispatched | 113 | Planner | dispatch or dated re-promise ≤7 days |
| 2 | Cabin ready, idle | 46 (34.6d median) | Planner | ≤7 days |
| 3 | Active job, no BOM | 67 | Planner + design | ≤5 days from ERP creation |
| 4 | Drawing info request open | 47 (47d median) | Brand coordinator | answer/route ≤48h, escalate at 7d |
| 5 | Payment pending approval | 129 / ₹2.96cr | Accounts (owner above threshold) | ≤48h |
| 6 | Dispatched, not delivery-confirmed | 62 LT | Install coordinator | ≤14 days |

Each queue = a screen in the ERP (assigned per person) + a morning WhatsApp
digest (max 10 items, oldest-first). **The digest always sends** — an explicit
"all clear, 0 items" line, because a silent channel is indistinguishable from a
broken one (this is also the dead-man's switch for the automation: the owner's
digest carries a heartbeat line with every cron's last-run time; a missing digest
IS the alarm).

### 4.3 Rituals (the entire meeting calendar)

| Ritual | When | Content |
|---|---|---|
| Dispatch standup | Daily 9:30, 15 min, at the factory board (printed list, Bengali/Hindi) | Today's dispatches; yesterday's misses + reason; blockers |
| Owner exception batch | Daily 17:00 (add 11:00 later if needed), ≤30 min | Exception cards only: job, question, options, recommendation. Cards without a recommendation bounce |
| Plan commit | Monday, 45 min | The week's dispatch list + MRP run; date moves need logged reasons |
| Weekly review | Friday, 60 min | The six scorecard numbers; holds defended or released; capacity decisions |

Owner's steady-state load: **~90 min/day**, down from all day. During months 1–3
it goes UP (~2h/day of interviewing, training, defending the new roles) before it
comes down — budget for this or the plan gets abandoned exactly when it's working.

---

## 5. Automation build plan (existing stack only: Next.js/Supabase/Netlify, pg_cron, the proven CRM bridge)

### Phase 0 — the true minimum (~12 dev-days, October, software-only)

1. **Terminal job status** (`completed`/`closed`) + supervised ghost-close sweep
   (report-only 3–4 weeks, human confirms the first ~100). Makes on-time %
   computable for the first time.
2. **`erp_users` table** (name, role, phone) + operator picker + `assigned_to` on
   jobs and queue items. This is the notification address book — the actual
   urgency, not security. (Full Supabase Auth deferred; no incentives paid on
   attribution data until then.)
3. **Days-overdue column + overdue/fire-list tabs on /jobs**, with the
   company-fault vs customer-fault (paused-clock) split.
4. **Payment % meter in the dispatch modal** (`getCrmFinancials` is one call
   away; below 75% requires a logged override reason — not a hard block).
5. **Derived job sets** (Overdue / Due-this-week / Paid-waiting) through the
   existing `?set=` plumbing on all MRP surfaces. Freeze the manual Urgent set
   read-only; delete after a month.
6. **Six queue screens + WhatsApp digests.** Interim channel: WhatsApp Business
   app with saved quick-replies (NOT email — coordinators don't open email).
   Apply for WhatsApp Business API verification for both brands in week 1 (1–3
   week lead).

### Phase 1 — the spine (~10 dev-days, November, after Phase 0 holds)

7. **Outbox + drain worker** (`erp_outbound_events`, pg_cron every few minutes)
   → new `erp_report_event` RPC on both CRMs, auto-stamping the dead lifecycle
   timestamps from the five ERP choke points that already fire
   (`createDispatch`, packing print, BOM audit, cabin ready/dispatched,
   completion sweep). First-write-wins, idempotent, dead-letter after 5 tries,
   unmatched-key % reported weekly. Timestamps are stamped; **CRM stages are
   suggested, never auto-flipped** (11% of stage moves are backward corrections —
   stage is judgment).
8. **`erp_job_lifecycle` RPC** per CRM (stage, transitions, open drawing
   requests, milestones) → CRM strip on ERP job detail + the drawing-request
   queue feed.
9. **Intake queue**: 15-min sync diffs CRM jobs at "Drawing Approved" against ERP
   (by normalised key) → three lanes (no ERP job / no BOM / no date), one-click
   create pre-filled from CRM, AI-autofill assist, human confirms. Never
   auto-create.
10. **Customer messages v1 — facts only**: (a) "Dispatched today, LR no. X" +
    balance PDF on `createDispatch`; (b) delivery-confirm request at +3 days —
    the customer's YES stamps `materials_delivered_at` and closes LT's black
    hole (backed by a human call at day 7; Bengali voice notes are the norm, the
    reply is a bonus). (c) payment receipt acknowledgement off the existing
    payment-events feed. **No forward-looking promises in any automated message
    until promise-kept ≥80% for 4 straight weeks internally.**

### Phase 2 — earned extensions (December onward, each gated on Phase 1 holding)

- Control Tower page (one screen, one next-action per job) — composition of the
  queue tables, built once queues are actually being worked.
- Welcome-call flow + site-contact capture (site numbers exist on only 9–15% of
  jobs); site-readiness as a human WhatsApp photo-checklist first, software
  module only if the habit survives two quarters.
- Published reciprocal dispatch policy ("75% + site ready → dispatch within 7
  working days") — ONLY after four consecutive weeks ≥80% internal
  promise-keeping; tender jobs exempted.
- Handover pack + certificate → final milestone wiring → **auto-create/link the
  AMC site record in the existing lt-amc platform** (`maintenance_id` — join
  fields exist, populated on 0 of 816 jobs). Complaints route into lt-amc's
  existing complaint module — do NOT build a parallel complaint system.
- Two-question WhatsApp CSAT (delivery 1–5; recommend YES/NO). Every ≤3 or NO =
  a named customer the owner personally calls that week.
- Supabase Auth (identity rung), machine-capacity table + promise feasibility
  check (material lead times + machine-hours), supplier OTIF scores from GRN
  data, installation slotting.

Running cost: WhatsApp ~₹1–3k/month all-in. Everything rides the existing three
Supabase projects + Netlify.

### Deliberately NOT automated

Promise dates (humans commit; system checks). Payment approval judgment (chase,
never approve). Hold release. CRM stage flips. Auto-creating ERP jobs/BOMs
(assist + confirm only). The make-plan optimiser's output. Inventory
corrections. Customer-facing exception noise.

---

## 6. Organisation & team size

### 6.1 The seats (serialized, one landing at a time)

| Seat | Who | When | Band (Kolkata 2026) |
|---|---|---|---|
| **LT Ops Lead** | The existing coordinator (the 74% person), promoted | **Before anything is announced.** Retention talk + **20–30% pay correction** + month-1 knowledge-documentation sprint. Highest attrition risk in the company; if they resign mid-transition the program pauses a quarter | correction on current pay |
| **Production Planner (PPC)** — the keystone | New hire. Diploma/BE Mech, 4–8 yrs PPC in sheet-metal/fabrication ETO (Dasnagar–Liluah–Belur belt, rail/switchgear vendors, competitor factories). Realistic lead time 8–12 weeks | Recruit from week 1; interim = owner + AI-generated daily dispatch list | **₹55–70k/mo + variable** (₹38–45k buys a chaser, not a planner) |
| **Ricardo Partner-Desk Coordinator** | New hire. Dealer/franchise-channel background (paints/cement/pumps are full of them) | ~6 weeks after Planner lands | ₹25–35k/mo |
| **Installation & Handover Coordinator** | New hire. Ex-service-coordinator from elevator/HVAC service firms | ~6 weeks later | ₹25–35k/mo |

Total: **~₹1.3–1.7 lakh/month** fully loaded. Against ₹103 cr of pre-dispatch
contract value and 113 already-paid customers whose MaterialReadiness milestones
(~35% of contract) bill on dispatch — the fire list alone self-funds this team.

An Ops Manager is **promoted from within at month 4–6** (Planner or LT Lead,
whoever holds queues at SLA for 8 straight weeks) — never hired externally on
day 1.

### 6.2 Who decides what (the short RACI)

- **Planner**: dates within the floor rule, weekly sequence, release-to-factory,
  job closure, the daily list. Nobody else touches priorities.
- **Owner(s)**: sub-75% dispatch exceptions, sub-floor promises, holds, payment
  approvals above threshold, overtime/outsourcing, cash. **There are two owners:
  split the A's explicitly (e.g. cash vs capacity) and route BOTH through the
  same exception-card mechanism** — a second owner side-channel-promising kills
  the system as surely as the first.
- **Coordinators**: chase, confirm, communicate. They never author BOMs and
  never promise unconfirmed dates.
- **Ricardo partners**: the field CX layer (welcome call, site photos, delivery
  confirm) — managed by SLA with a real commercial lever (dispatch priority /
  payout release tied to the three partner SLAs, written into the agreement).
  Money/date messages always come from the central brand number, never partners.

### 6.3 Accountability without policing

Workflow gates enforce; auto-stamps remove chores; the metric family is **age of
oldest item in your queue** (with escalation-rate as the counterweight). Monthly
hygiene bonus (₹1.5–3k, system-computed, 2–3 thresholds the person fully
controls) — but **no money on any metric until identity is real** (Auth rung).
The Friday scoreboard includes **owner SLA compliance** (cards answered ≤1 batch,
approvals ≤48h, overrides/week) — the 146-day pending payment is an owner-side
miss and the system should say so as plainly as it says everything else.

---

## 7. The scorecard (six numbers, one SQL definition each, versioned in the repo)

| # | Number | Baseline (2026-09-26) | 90-working-day target |
|---|---|---|---|
| 1 | Company-fault overdue (≥75% paid, past promise, not dispatched) | ~30 standing / 113 total fire list | **0 standing** |
| 2 | Strict-coverage overdue (company-fault only, post-amnesty) | 212 blended | <60 honest |
| 3 | Cabin ready→dispatch median days | 34.6 | ≤7 |
| 4 | Blocked intake (no-BOM + drawing-info>7d + welcome-call>3d) | 67 + 47 + 77 | ~0 + <5 + <10 |
| 5 | Throughput vs intake (full-coverage completions / new jobs) | 0.64 | ≥1.0 |
| 6 | Promise-kept % (vs latest promise, week granularity) | unmeasurable | ≥80% measured |

Plus two standing health lines: unmatched-key % on the bridge, and the cron
heartbeat (dead-man's switch).

---

## 8. Calendar reality (start clocks Nov 1, not Oct 1)

**Durga Puja erases 2–3 weeks of October** in Howrah — factory throughput, hiring
pipelines, partner responsiveness and Meta template approvals all stall.
September's −38% run rate is likely already the pre-Puja slowdown.

- **October (Puja month):** software-only Phase 0; LT-lead retention correction;
  Planner recruiting; WhatsApp Business verification; the backlog re-segmentation
  and ghost-close (report-only); the 113-job fire-list triage session (owner +
  coordinators, one sitting).
- **November:** burn-down clocks start. Fire-list tranches (~15/week, gated on
  paid% + site sanity), amnesty messages in weekly tranches of ~30 (never all at
  once — the reply storm would swamp two people), Phase 1 build, Planner lands.
- **December:** queues at SLA or escalated daily; Ricardo desk hire lands;
  customer facts-messages live; first honest promise-kept measurements.
- **Q1 2027:** Phase 2 items, each earned by eight clean weeks of the layer
  beneath it.

---

## 9. Top five risks (from the adversarial critique) and their mitigations

1. **The owner doesn't change.** Every mechanism dies on the first public
   override. Mitigations: a written 90-day pact ("no overrides except a logged
   bump"); owner SLA lines on the same scoreboard; start with ONE ritual (the
   17:00 batch); build the owner's digest FIRST so scanning is replaced before
   anything is taken away; the forward-the-call ritual enforced for two weeks.
2. **Coordinators author BOMs.** Never — wrong BOMs poison MRP silently. BOM
   authorship = Planner + design engineers, predictor-assisted, audit-gated.
3. **Published promises before capability.** A written 7-day clock before the
   backlog clears converts deniable verbal lateness into archived breaches.
   Facts-only messages for 8–12 weeks; policy published per-brand only after 4
   straight weeks ≥80% internal promise-keeping.
4. **Hiring math.** Planner at ₹38–45k in 4 weeks is fiction — budget ₹55–70k
   and 8–12 weeks; serialize hires 6 weeks apart; fix the LT lead's pay FIRST.
5. **Automation rots and nobody notices.** Six rules max at launch, each with a
   named owner; all state changes report-only 3–4 weeks; weekly rule-kill review
   (any rule un-actioned 2 weeks is publicly deleted); the always-sent digest
   with cron heartbeats is the dead-man's switch; a printed one-page runbook per
   automated flow that a non-developer can follow.

---

## 10. The first two weeks, concretely

1. LT lead: retention conversation + pay correction (owner, this week).
2. Post the Planner JD (band ₹55–70k); start sourcing.
3. Apply for WhatsApp Business API verification, both brands.
4. Ship Phase 0 items 1–5 (terminal status report-only, users table, overdue/fire
   tabs with the paused-clock split, payment meter in dispatch modal, derived
   sets).
5. One sitting: triage the 113 fire-list jobs (paid ≥75%) — dispatchable now /
   needs material / needs site check — and the 25 ERP + 34 CRM holds.
6. Start the ghost-close review list (95 jobs) and the no-BOM backfill at
   6–8/week with design.
7. Owner starts the single 17:00 exception batch — the first and only new habit
   this fortnight.
