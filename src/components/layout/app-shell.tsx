import { Sidebar } from "./sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { GlobalSearch } from "./global-search";

export function AppShell({ children }: { children: React.ReactNode }) {
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
