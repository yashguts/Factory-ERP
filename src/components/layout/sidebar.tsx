"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Package,
  Layers,
  ClipboardList,
  Calculator,
  Home,
  Settings,
  History,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/inventory/changes", label: "Daily Changes", icon: History },
  { href: "/bom", label: "Bill of Materials", icon: Layers },
  { href: "/jobs", label: "Job Orders", icon: ClipboardList },
  { href: "/mrp", label: "MRP", icon: Calculator },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  // Pick the single most-specific matching nav href so nested routes (e.g.
  // /inventory/changes) don't light up their parent ("Inventory") as well.
  const activeHref = navItems
    .map((i) => i.href)
    .filter((href) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(href + "/"),
    )
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="w-64 border-r border-[var(--border)] h-screen sticky top-0 flex flex-col">
      <div className="p-4 border-b border-[var(--border)]">
        <h1 className="text-lg font-bold">Factory ERP</h1>
        <p className="text-xs text-[var(--muted-foreground)]">Elevator Manufacturing</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === activeHref;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              )}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
