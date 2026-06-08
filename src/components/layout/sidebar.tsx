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
  Cog,
  Boxes,
  Container,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/cabin-inventory", label: "Cabin Inventory", icon: Container },
  { href: "/inventory/changes", label: "Daily Changes", icon: History },
  { href: "/subassemblies", label: "Sub-assemblies", icon: Boxes },
  { href: "/bom", label: "Bill of Materials", icon: Layers },
  { href: "/programs", label: "Programs", icon: Cog },
  { href: "/jobs", label: "Job Orders", icon: ClipboardList },
  { href: "/mrp", label: "MRP", icon: Calculator },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  const activeHref = navItems
    .map((i) => i.href)
    .filter((href) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(href + "/"),
    )
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="w-64 border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] h-screen sticky top-0 flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--sidebar-border)]">
        <h1 className="text-base font-bold tracking-tight">Factory ERP</h1>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Elevator Manufacturing
        </p>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === activeHref;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150",
                isActive
                  ? "bg-[var(--sidebar-accent)] text-[var(--primary)] font-medium shadow-[var(--shadow-xs)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              )}
            >
              <Icon size={18} strokeWidth={isActive ? 2.25 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
