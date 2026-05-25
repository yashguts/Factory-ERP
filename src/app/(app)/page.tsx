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
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
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
              className="p-5 rounded-lg border border-[var(--border)] hover:border-[var(--primary)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--muted-foreground)]">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <Icon size={24} className="text-[var(--muted-foreground)]" />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[var(--border)] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-[var(--warning)]" />
            <h2 className="font-semibold">Low Stock Alerts</h2>
          </div>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.item}
                className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{alert.item}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Reorder at {alert.reorder} {alert.unit}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-bold ${
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

        <div className="border border-[var(--border)] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown size={18} className="text-[var(--primary)]" />
            <h2 className="font-semibold">Recent Activity</h2>
          </div>
          <div className="space-y-3">
            {[
              { action: "Purchase In", item: "Guide Rail T89/B", qty: "+20 pcs", time: "2h ago" },
              { action: "Production Out", item: "Wire Rope 12mm", qty: "-45 m", time: "5h ago" },
              { action: "Job Created", item: "JOB-2024-009", qty: "8-Person Elevator", time: "1d ago" },
              { action: "BOM Updated", item: "Car Door Assembly v2", qty: "3 items changed", time: "2d ago" },
            ].map((activity, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{activity.action}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{activity.item}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm">{activity.qty}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
