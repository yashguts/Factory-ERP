import { Sidebar } from "./sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { GlobalSearch } from "./global-search";

export function AppShell({ children }: { children: React.ReactNode }) {
  // NOTE: keep this layout SYNCHRONOUS. It re-renders on every server-action
  // revalidation (i.e. every save) across the whole app, so it must not block
  // on a data fetch — doing so makes every save hang on the spinner. The
  // "Job Orders" GAD-drift badge is fetched client-side inside the Sidebar
  // instead, decoupled from the save/render cycle.
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-[var(--canvas)]">
        <Sidebar />
        <main className="flex-1 px-6 py-5 overflow-auto">{children}</main>
      </div>
      <GlobalSearch />
    </ToastProvider>
  );
}
