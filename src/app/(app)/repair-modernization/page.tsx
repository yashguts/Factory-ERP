import { PageHeader } from "@/components/ui/page-header";
import { Wrench } from "lucide-react";

export const metadata = { title: "Repair and Modernization" };

// Placeholder surface for the Repair & Modernization business line. The nav
// entry and route exist so the link works; the actual content is built out
// once the owner specs what this area should do.
export default function RepairModernizationPage() {
  return (
    <div>
      <PageHeader
        title="Repair and Modernization"
        icon={<Wrench size={18} />}
        subtitle="Repair and modernization of existing elevators"
      />
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">
          This section is set up and ready to build out. Tell me what you want
          here — a list of repair / modernization jobs, a form, reports — and
          I&apos;ll wire it up.
        </p>
      </div>
    </div>
  );
}
