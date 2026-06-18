import { Sidebar } from "./sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { GlobalSearch } from "./global-search";
import { getGadDriftCount } from "@/lib/actions/gad-alerts";

export async function AppShell({ children }: { children: React.ReactNode }) {
  // Red count on "Job Orders": jobs whose GAD changed after the BOM was defined.
  // Cached (revalidate 120s, tag "gad-alerts") so this doesn't hit the DB on
  // every navigation.
  const gadDrift = await getGadDriftCount();

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-[var(--canvas)]">
        <Sidebar badges={{ "/jobs": gadDrift }} />
        <main className="flex-1 px-6 py-5 overflow-auto">{children}</main>
      </div>
      <GlobalSearch />
    </ToastProvider>
  );
}
