"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
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
  ShoppingCart,
  Truck,
  PackageSearch,
  Settings,
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
    ],
  },
  {
    label: "Orders",
    items: [
      { href: "/jobs", label: "Job Orders", icon: ClipboardList },
      { href: "/cabin-jobs", label: "Cabin Jobs", icon: ClipboardCheck },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/mrp", label: "Make MRP", icon: Calculator },
      { href: "/mrp/trade", label: "Trade MRP", icon: Truck },
      { href: "/mrp/shortfall", label: "Job Shortfall", icon: PackageSearch },
      { href: "/procurement", label: "Procurement", icon: ShoppingCart },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const allItems = navGroups.flatMap((g) => g.items);

export function Sidebar() {
  const pathname = usePathname();

  const activeHref = allItems
    .map((i) => i.href)
    .filter((href) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(href + "/"),
    )
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="w-56 border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] h-screen sticky top-0 flex flex-col">
      <div className="px-4 py-3.5 border-b border-[var(--sidebar-border)]">
        <h1 className="text-sm font-bold tracking-tight">Factory ERP</h1>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
          Elevator Manufacturing
        </p>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-global-search"))
          }
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-[var(--muted-foreground)] border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer transition-colors"
        >
          <Search size={15} strokeWidth={1.75} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--muted)]">
            Ctrl K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && "mt-4")}>
            <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-all duration-150",
                      isActive
                        ? "bg-[var(--sidebar-accent)] text-[var(--primary)] font-medium shadow-[var(--shadow-xs)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    )}
                  >
                    <Icon size={16} strokeWidth={isActive ? 2.25 : 1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
