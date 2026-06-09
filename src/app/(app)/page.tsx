import { Suspense } from "react";
import Link from "next/link";
import {
  Truck,
  ShoppingCart,
  Factory,
  Wrench,
  History,
  Plus,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { getDashboardCounts, type DueJob } from "@/lib/actions/dashboard";
import { getJobsDispatchStatus, type DispatchStatus } from "@/lib/actions/dispatch";
import { getMrpData } from "@/lib/actions/mrp";

export const dynamic = "force-dynamic";

/** Factory runs on IST — compute "today" in Asia/Kolkata regardless of server TZ. */
function istTodayISO(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  first_phase: "First Phase",
  full_material: "Full Material",
};

const DISPATCH_BADGE: Record<DispatchStatus, { label: string; cls: string }> = {
  none: { label: "Pending", cls: "text-[var(--muted-foreground)]" },
  partial: { label: "Partial", cls: "text-amber-600" },
  full: { label: "Dispatched", cls: "text-green-600" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

export default async function DashboardPage() {
  const today = istTodayISO();
  const counts = await getDashboardCounts(today);
  const dispatchStatus = await getJobsDispatchStatus(
    counts.dueJobs.map((j) => j.id),
  );

  const hygieneTotal =
    counts.unmatchedBomLines + counts.outputsNeedingItem;

  return (
    <div>
      {/* Header + quick actions */}
      <div className="flex items-end justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Today at the factory
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {new Date(today).toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/jobs/new"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New Job
          </Link>
          <Link
            href="/inventory/changes"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-sm font-medium hover:bg-[var(--muted)]"
          >
            <History className="h-4 w-4" /> Daily Changes
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT 2/3 — dispatches due + hygiene */}
        <div className="lg:col-span-2 space-y-6">
          <DueJobsCard
            jobs={counts.dueJobs}
            dueCount={counts.dueCount}
            overdueCount={counts.overdueCount}
            dispatchStatus={dispatchStatus}
            today={today}
          />

          {/* Fix-it queue */}
          <div className="card-surface p-5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-7 w-7 rounded-md bg-[var(--warning-bg)] flex items-center justify-center">
                <Wrench size={14} className="text-[var(--warning)]" />
              </div>
              <h2 className="font-semibold">Fix-it queue</h2>
              {hygieneTotal === 0 && (
                <span className="text-xs text-green-600 font-medium">
                  All clean ✓
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mb-3">
              Small data gaps that make reports less trustworthy — knock them
              off when you have a spare minute.
            </p>
            <div className="divide-y divide-[var(--border)]">
              <FixItRow
                count={counts.unmatchedBomLines}
                label="BOM lines not matched to an inventory item"
                href="/jobs/unmatched"
                cta="Match them"
              />
              <FixItRow
                count={counts.outputsNeedingItem}
                label="program outputs still needing an item"
                href="/programs?match=unmatched"
                cta="Resolve in Programs"
              />
              <FixItRow
                count={counts.programsPendingAudit}
                label="programs not yet audited"
                href="/programs?audit=pending"
                cta="Review & audit"
              />
            </div>
          </div>
        </div>

        {/* RIGHT 1/3 — shortfalls (streamed) + activity */}
        <div className="space-y-6">
          <Suspense fallback={<ShortfallSkeleton />}>
            <MrpShortfallCards />
          </Suspense>

          <div className="card-surface p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center">
                <History size={14} className="text-[var(--primary)]" />
              </div>
              <h2 className="font-semibold">Activity today</h2>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">
                  Stock movements
                </span>
                <span className="font-semibold tabular-nums">
                  {counts.stockMovesToday}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">
                  Item edits
                </span>
                <span className="font-semibold tabular-nums">
                  {counts.changesToday}
                </span>
              </div>
            </div>
            <Link
              href="/inventory/changes"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline mt-3"
            >
              See the full trail <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DueJobsCard({
  jobs,
  dueCount,
  overdueCount,
  dispatchStatus,
  today,
}: {
  jobs: DueJob[];
  dueCount: number;
  overdueCount: number;
  dispatchStatus: Record<string, DispatchStatus>;
  today: string;
}) {
  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center">
            <Truck size={14} className="text-[var(--primary)]" />
          </div>
          <h2 className="font-semibold">Dispatches due</h2>
          <span className="text-xs text-[var(--muted-foreground)]">
            next 7 days
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--destructive)] font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              {overdueCount} overdue
            </span>
          )}
          <Link
            href="/jobs?sort=req_dispatch&dir=asc"
            className="font-medium text-[var(--primary)] hover:underline"
          >
            All jobs →
          </Link>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)] py-4">
          Nothing due in the next 7 days. 🎉
        </p>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {jobs.map((j) => {
            const ds = DISPATCH_BADGE[dispatchStatus[j.id] ?? "none"];
            return (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="flex items-center gap-3 py-2.5 group"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium group-hover:text-[var(--primary)] truncate">
                    {j.job_number}
                    <span className="font-normal text-[var(--muted-foreground)]">
                      {" "}
                      · {j.customer_name ?? "—"}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    Stage: {STAGE_LABEL[j.stage ?? ""] ?? j.stage ?? "—"}
                  </div>
                </div>
                <span className={`text-xs font-medium ${ds.cls}`}>
                  {ds.label}
                </span>
                <span
                  className={`text-xs font-semibold tabular-nums w-16 text-right ${
                    j.overdue
                      ? "text-[var(--destructive)]"
                      : j.requirement_dispatch_date === today
                        ? "text-amber-600"
                        : ""
                  }`}
                >
                  {fmtDate(j.requirement_dispatch_date)}
                </span>
              </Link>
            );
          })}
          {dueCount > jobs.length && (
            <Link
              href="/jobs?sort=req_dispatch&dir=asc"
              className="block pt-2.5 text-xs font-medium text-[var(--primary)] hover:underline"
            >
              + {dueCount - jobs.length} more due this week
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function FixItRow({
  count,
  label,
  href,
  cta,
}: {
  count: number;
  label: string;
  href: string;
  cta: string;
}) {
  if (count === 0) return null;
  return (
    <Link href={href} className="flex items-center gap-3 py-2.5 group">
      <span className="text-sm font-bold tabular-nums w-10 text-right">
        {count.toLocaleString()}
      </span>
      <span className="text-sm flex-1 text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]">
        {label}
      </span>
      <span className="text-xs font-medium text-[var(--primary)] inline-flex items-center gap-1">
        {cta} <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

/* Streams in after the (cached) MRP computation finishes — the page shell
   never waits for it. */
async function MrpShortfallCards() {
  const rows = await getMrpData();
  let tradeItems = 0,
    tradeUnits = 0,
    makeItems = 0,
    makeUnits = 0;
  for (const r of rows) {
    if (r.shortfall <= 0) continue;
    if (r.procurement_type === "trade") {
      tradeItems++;
      tradeUnits += r.shortfall;
    } else if (r.procurement_type === "make") {
      makeItems++;
      makeUnits += r.shortfall;
    }
  }

  return (
    <>
      <ShortfallCard
        icon={<ShoppingCart size={14} className="text-[var(--primary)]" />}
        title="To procure"
        subtitle="Trade items short across in-production jobs"
        items={tradeItems}
        units={tradeUnits}
        href="/mrp?tab=trade&show=shortfall"
        cta="Open buy list"
      />
      <ShortfallCard
        icon={<Factory size={14} className="text-[var(--primary)]" />}
        title="To manufacture"
        subtitle="Make items short — plan programs to run"
        items={makeItems}
        units={makeUnits}
        href="/mrp?tab=make&show=shortfall"
        cta="Open make plan"
      />
    </>
  );
}

function ShortfallCard({
  icon,
  title,
  subtitle,
  items,
  units,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  items: number;
  units: number;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="card-surface p-5 block hover:border-[var(--primary)] hover:shadow-[var(--shadow-md)] transition-all duration-200"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center">
          {icon}
        </div>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-3xl font-bold tabular-nums ${items > 0 ? "text-[var(--destructive)]" : "text-green-600"}`}
        >
          {items}
        </span>
        <span className="text-sm text-[var(--muted-foreground)]">
          item{items === 1 ? "" : "s"} short
          {items > 0 && ` · ${Math.round(units).toLocaleString()} units`}
        </span>
      </div>
      <p className="text-xs text-[var(--muted-foreground)] mt-1.5">{subtitle}</p>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] mt-2">
        {cta} <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function ShortfallSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="card-surface p-5 animate-pulse">
          <div className="h-5 w-32 bg-[var(--muted)] rounded mb-3" />
          <div className="h-8 w-24 bg-[var(--muted)] rounded mb-2" />
          <div className="h-3 w-44 bg-[var(--muted)] rounded" />
        </div>
      ))}
    </>
  );
}
