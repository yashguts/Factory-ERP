import { Sidebar } from "./sidebar";
import { ToastProvider } from "@/components/ui/toast";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-[var(--canvas)]">
        <Sidebar />
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </ToastProvider>
  );
}
