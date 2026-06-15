"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange, ListChecks, Hammer, ShoppingCart, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type MrpView = "requirements" | "programs" | "buy" | "weekly";
export type MrpSection = "make" | "trade";

type ViewDef = { key: MrpView; label: string; href: string; icon: typeof ListChecks };

// The MRP is split into two sidebar sections: Make (the manufacturing side —
// requirements, programs to run, sheets, weekly) and Trade (the bought-in side —
// requirements + a weekly short-list). Each section gets its own view switcher.
const MAKE_VIEWS: ViewDef[] = [
  { key: "requirements", label: "Requirements", href: "/mrp", icon: ListChecks },
  { key: "programs", label: "Programs to run", href: "/mrp/make-plan", icon: Hammer },
  { key: "weekly", label: "Weekly plan", href: "/mrp/weekly", icon: CalendarRange },
];
const TRADE_VIEWS: ViewDef[] = [
  { key: "requirements", label: "Requirements", href: "/mrp/trade", icon: ListChecks },
  { key: "buy", label: "Buy list", href: "/mrp/trade/buy", icon: ShoppingCart },
  { key: "weekly", label: "Weekly plan", href: "/mrp/trade/weekly", icon: CalendarRange },
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Shared MRP toolbar: a segmented view-switcher (Requirements / Programs to run /
 * Buy list) plus one date control. Pick the cutoff once and switch views with it
 * preserved. Changing the date navigates within the CURRENT view.
 */
export function MrpToolbar({
  view,
  date,
  section = "make",
}: {
  view: MrpView;
  date: string;
  section?: MrpSection;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const VIEWS = section === "trade" ? TRADE_VIEWS : MAKE_VIEWS;
  const current = VIEWS.find((v) => v.key === view)!;
  const q = (d: string) => (d ? `?date=${d}` : "");
  const go = (d: string) => startTransition(() => router.push(`${current.href}${q(d)}`));

  const now = new Date();
  const presets: { label: string; value: string }[] = [
    { label: "End of month", value: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) },
    { label: "+30 days", value: ymd(new Date(now.getTime() + 30 * 86400000)) },
    { label: "+60 days", value: ymd(new Date(now.getTime() + 60 * 86400000)) },
  ];
  const pretty = date
    ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className="mb-4 flex items-center gap-2 flex-wrap">
      {/* View switcher */}
      <div className="inline-flex w-fit rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-0.5">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = v.key === view;
          return (
            <Link
              key={v.key}
              href={`${v.href}${q(date)}`}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium cursor-pointer transition-colors",
                active
                  ? "bg-[var(--card)] shadow-sm text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon className="h-4 w-4" />
              {v.label}
            </Link>
          );
        })}
      </div>

      {/* Date control (the weekly view has a fixed today-relative horizon) */}
      {view === "weekly" ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
          <CalendarRange className="h-4 w-4 shrink-0 text-[var(--primary)]" />
          Next <strong className="text-[var(--foreground)]">8 weeks</strong> from today, cumulatively (Overdue + each week).
        </span>
      ) : (
      <div
        className="inline-flex items-center gap-2 flex-wrap"
        title={
          date
            ? `Counting jobs due on or before ${pretty}`
            : "No date set: counting every in-production job"
        }
      >
        <CalendarDays className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap">Plan jobs due by</span>
        <input
          type="date"
          value={date}
          onChange={(e) => go(e.target.value)}
          className="h-8 w-[170px] rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 text-sm cursor-pointer hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] [color-scheme:dark]"
        />
        {date && (
          <button
            type="button"
            onClick={() => go("")}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--border)] text-xs cursor-pointer text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            title="Remove the date limit"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-[var(--muted-foreground)] mr-1">Quick:</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => go(p.value)}
              className={cn(
                "px-2 py-1 rounded-md text-[11px] border cursor-pointer transition-colors",
                date === p.value
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {isPending && <span className="text-xs text-[var(--muted-foreground)]">updating…</span>}
      </div>
      )}
    </div>
  );
}
