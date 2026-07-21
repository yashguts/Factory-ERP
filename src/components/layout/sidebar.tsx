"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useOperator } from "@/lib/jobs/use-operator";
import { getGadDriftCount } from "@/lib/actions/gad-alert-count";
import { getStatusAlertCount } from "@/lib/actions/status-alert-count";
import { getCrmPaymentEventCount } from "@/lib/actions/crm-payment-event-count";
import { isStaleActionError } from "@/components/layout/stale-deploy-guard";
import {
  Package,
  ClipboardList,
  Calculator,
  History,
  Cog,
  Boxes,
  Container,
  ClipboardCheck,
  Search,
  PlayCircle,
  Blocks,
  ShoppingCart,
  Truck,
  PackageSearch,
  Network,
  LayoutGrid,
  Archive,
  UserRound,
  Bell,
  IndianRupee,
  LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Grouped, data-driven nav. The flat href set (derived below) still feeds the
// exact longest-prefix active-match logic — grouping only changes how items are
// visually bucketed, never which hrefs the matcher sees.
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Inventory",
    items: [
      { href: "/inventory", label: "Inventory", icon: Package },
      { href: "/cabin-inventory", label: "Cabin Inventory", icon: Container },
      { href: "/subassemblies", label: "Sub-assemblies", icon: Boxes },
      { href: "/inventory/changes", label: "Daily Changes", icon: History },
    ],
  },
  {
    label: "Production",
    items: [
      { href: "/programs", label: "Programs", icon: Cog },
      { href: "/program-runs", label: "Program Runs", icon: PlayCircle },
      { href: "/child-parts", label: "Child Parts", icon: Blocks },
    ],
  },
  {
    label: "Orders",
    items: [
      { href: "/jobs", label: "Job Orders", icon: ClipboardList },
      // Permanent home for status/date-change alerts + their full history —
      // the amber open-alert count lives here (GAD red stays on Job Orders).
      { href: "/jobs/status-alerts", label: "Status Alerts", icon: Bell },
      // Payment updates flowing in live from the Ricardo / LT Elevator CRMs —
      // the emerald badge blinks until every event is acknowledged.
      { href: "/jobs/crm-payments", label: "CRM Payments", icon: IndianRupee },
      { href: "/cabin-jobs", label: "Cabin Jobs", icon: ClipboardCheck },
      // Read-only archive of the pre-cutover Job Order BOMs (2026-07-03) —
      // a transition-period reference; remove once the team stops needing it.
      { href: "/bom", label: "BOM (old)", icon: Archive },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/mrp", label: "Make MRP", icon: Calculator },
      { href: "/mrp/trade", label: "Trade MRP", icon: Truck },
      { href: "/mrp/cabin", label: "Cabin MRP", icon: LayoutGrid },
      { href: "/mrp/shortfall", label: "Job Shortfall", icon: PackageSearch },
      { href: "/demand", label: "Demand Rules", icon: Network },
      { href: "/procurement", label: "Procurement", icon: ShoppingCart },
    ],
  },
];

const allItems = navGroups.flatMap((g) => g.items);

export function Sidebar() {
  const pathname = usePathname();
  const { operator, ensureOperator, setOperator } = useOperator();

  // GAD-drift count for the "Job Orders" red badge. Fetched CLIENT-SIDE here —
  // not in the server layout — so it never blocks a save's revalidation render
  // (which previously made every save hang). Refreshes on navigation; the
  // underlying action is cached (120s) so repeat calls are cheap.
  const [gadDrift, setGadDrift] = useState(0);
  // Open job status alerts (started / held / reverted / resumed) → amber badge.
  const [statusAlerts, setStatusAlerts] = useState(0);
  useEffect(() => {
    let alive = true;
    getGadDriftCount()
      .then((n) => {
        if (alive) setGadDrift(n);
      })
      .catch(() => {});
    getStatusAlertCount()
      .then((n) => {
        if (alive) setStatusAlerts(n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  // Unacknowledged CRM payment events → blinking emerald badge. This is the
  // app's one interval poll: payments land in the CRMs while the user sits on
  // a single ERP page, so navigation-triggered refetches alone would never
  // blink. 60s matches the CRM feed's server-side cache TTL. Stale-deploy
  // errors are re-thrown so StaleDeployGuard prompts a reload instead of the
  // poll failing silently forever (see stale-deploy-guard.tsx).
  const [payEvents, setPayEvents] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      getCrmPaymentEventCount()
        .then((n) => {
          if (alive) setPayEvents(n);
        })
        .catch((e) => {
          if (isStaleActionError(e)) throw e;
        });
    };
    tick();
    const id = setInterval(tick, 60_000);
    // The CRM Payments page fires this right after an acknowledge so the
    // blinker clears immediately instead of on the next tick.
    window.addEventListener("crm-payments-refresh", tick);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("crm-payments-refresh", tick);
    };
  }, [pathname]);

  const activeHref = allItems
    .map((i) => i.href)
    .filter((href) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(href + "/"),
    )
    .sort((a, b) => b.length - a.length)[0];

  // Collapsed icon-rail that expands to the full labelled panel on hover /
  // keyboard focus. The rail stays a slim 64px in the page flow (see the
  // spacer below) so every page gets ~160px more width; the expanded panel
  // is an overlay (fixed, high z-index) so hovering never reflows the content.
  // `labelReveal` = text/badges that fade in only when the panel is open.
  const labelReveal =
    "whitespace-nowrap overflow-hidden opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100";

  return (
    <>
      {/* Spacer: reserves the collapsed rail's slot in the flex layout so the
          fixed overlay panel below doesn't sit on top of the page content. */}
      <div className="w-16 shrink-0" aria-hidden />

      <aside
        className="group fixed left-0 top-0 z-40 flex h-screen w-16 flex-col overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] transition-[width] duration-200 ease-out hover:w-56 hover:shadow-xl focus-within:w-56 focus-within:shadow-xl"
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--sidebar-border)] px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-sm font-bold text-[var(--primary-foreground)]">
            FE
          </div>
          <div className={labelReveal}>
            <h1 className="text-sm font-bold leading-tight tracking-tight">Factory ERP</h1>
            <p className="text-[11px] leading-tight text-[var(--muted-foreground)]">
              Elevator Manufacturing
            </p>
          </div>
        </div>

        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("open-global-search"))
            }
            title="Search (Ctrl K)"
            className="flex w-full items-center gap-2.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
          >
            <Search size={15} strokeWidth={1.75} className="shrink-0" />
            <span className={cn("flex-1 text-left", labelReveal)}>Search…</span>
            <kbd className={cn("rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px]", labelReveal)}>
              Ctrl K
            </kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
          {navGroups.map((group, gi) => (
            <div key={group.label} className={cn(gi > 0 && "mt-4")}>
              {/* Header keeps its row height when collapsed so the gap still
                  separates the groups; the text just fades out. */}
              <div className={cn("mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]", labelReveal)}>
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === activeHref;
                  const badge = item.href === "/jobs" ? gadDrift : 0;
                  const statusBadge = item.href === "/jobs/status-alerts" ? statusAlerts : 0;
                  const payBadge = item.href === "/jobs/crm-payments" ? payEvents : 0;
                  const hasAlert = badge > 0 || statusBadge > 0 || payBadge > 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-all duration-150",
                        isActive
                          ? "bg-[var(--sidebar-accent)] text-[var(--primary)] font-medium shadow-[var(--shadow-xs)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      )}
                    >
                      <span className="relative shrink-0">
                        <Icon size={16} strokeWidth={isActive ? 2.25 : 1.75} />
                        {/* Collapsed: a single alert dot on the icon (red for
                            GAD drift, amber for status, pulsing emerald for
                            new CRM payments). Hidden once the panel opens and
                            the full counts show inline. */}
                        {hasAlert &&
                          (payBadge > 0 ? (
                            <span className="absolute -right-1 -top-1 flex h-2 w-2 group-hover:hidden group-focus-within:hidden">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[var(--sidebar)]" />
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-[var(--sidebar)] group-hover:hidden group-focus-within:hidden",
                                badge > 0 ? "bg-red-600" : "bg-amber-500"
                              )}
                            />
                          ))}
                      </span>
                      <span className={cn("flex-1", labelReveal)}>{item.label}</span>
                      {statusBadge > 0 && (
                        <span
                          title={`${statusBadge} open job status alert${statusBadge === 1 ? "" : "s"}`}
                          className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white", labelReveal)}
                        >
                          {statusBadge > 99 ? "99+" : statusBadge}
                        </span>
                      )}
                      {badge > 0 && (
                        <span
                          title={`${badge} GAD change${badge === 1 ? "" : "s"} need review`}
                          className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white", labelReveal)}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                      {payBadge > 0 && (
                        <span
                          title={`${payBadge} new CRM payment update${payBadge === 1 ? "" : "s"}`}
                          className={cn("notif-blink inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold leading-none text-white", labelReveal)}
                        >
                          {payBadge > 99 ? "99+" : payBadge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Operator identity — the name attached to GAD uploads / job creates /
            audits (no login in this app). Click to set or change. */}
        <div className="border-t border-[var(--sidebar-border)] px-3 py-2">
          <button
            type="button"
            onClick={() => {
              if (operator) {
                const next = window.prompt("Change your name (used on the audit trail):", operator);
                if (next !== null) setOperator(next);
              } else {
                ensureOperator();
              }
            }}
            title={operator ? `Signed in as ${operator}` : "Set your name (used on the audit trail)"}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <UserRound size={16} strokeWidth={1.75} className="shrink-0" />
            <span className={cn("flex-1 truncate text-left", labelReveal)}>
              {operator ? operator : <span className="italic opacity-80">Set your name…</span>}
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
