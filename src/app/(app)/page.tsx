import { Package, Layers, ClipboardList, Calculator, AlertTriangle, TrendingDown } from "lucide-react";
import Link from "next/link";

const stats = [
  { label: "Total Items", value: "156", icon: Package, href: "/inventory" },
  { label: "Active BOMs", value: "12", icon: Layers, href: "/bom" },
  { label: "Open Jobs", value: "8", icon: ClipboardList, href: "/jobs" },
  { label: "Pending MRP", value: "23", icon: Calculator, href: "/mrp" },
];

const alerts = [
  { item: "Wire Rope 12mm", stock: 350, reorder: 200, unit: "m", severity: "warning" as const },
  { item: "Guide Rail T89/B 5m", stock: 12, reorder: 20, unit: "pcs", severity: "critical" as const },
  { item: "Safety Gear OSG", stock: 2, reorder: 5, unit: "nos", severity: "critical" as const },
];

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Overview of your elevator manufacturing operations
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="group card-surface p-5 hover:border-[var(--primary)] hover:shadow-[var(--shadow-md)] transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    {stat.label}
                  </p>
                  <p className="text-2xl font-bold mt-1.5 tabular-nums">{stat.value}</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-[var(--accent)] flex items-center justify-center group-hover:bg-[var(--primary)] group-hover:text-[var(--primary-foreground)] transition-colors duration-200">
                  <Icon size={20} className="text-[var(--primary)] group-hover:text-[var(--primary-foreground)]" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-7 w-7 rounded-md bg-[var(--warning-bg)] flex items-center justify-center">
              <AlertTriangle size={14} className="text-[var(--warning)]" />
            </div>
            <h2 className="font-semibold">Low Stock Alerts</h2>
          </div>
          <div className="space-y-0">
            {alerts.map((alert) => (
              <div
                key={alert.item}
                className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{alert.item}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    Reorder at {alert.reorder} {alert.unit}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-bold tabular-nums ${
                      alert.severity === "critical"
                        ? "text-[var(--destructive)]"
                        : "text-[var(--warning)]"
                    }`}
                  >
                    {alert.stock} {alert.unit}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center">
              <TrendingDown size={14} className="text-[var(--primary)]" />
            </div>
            <h2 className="font-semibold">Recent Activity</h2>
          </div>
          <div className="space-y-0">
            {[
              { action: "Purchase In", item: "Guide Rail T89/B", qty: "+20 pcs", time: "2h ago" },
              { action: "Production Out", item: "Wire Rope 12mm", qty: "-45 m", time: "5h ago" },
              { action: "Job Created", item: "JOB-2024-009", qty: "8-Person Elevator", time: "1d ago" },
              { action: "BOM Updated", item: "Car Door Assembly v2", qty: "3 items changed", time: "2d ago" },
            ].map((activity, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{activity.action}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{activity.item}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums">{activity.qty}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
