"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App-wide toast notifications.
 *
 * Until now every surface invented its own feedback (silent modal close,
 * window.alert, inline pill, full refresh) — so users were often unsure
 * whether a save actually happened. This provides ONE consistent voice:
 *
 *   const toast = useToast();
 *   toast.success("Dispatch recorded — First phase, 5 items");
 *   toast.error("Could not save: duplicate code");
 *
 * Renders bottom-right, auto-dismisses (success 3.5s / error 7s), capped
 * stack, manual dismiss, z-index above modals (which sit at 50/60).
 */

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  leaving?: boolean;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 4;
const DURATION: Record<ToastVariant, number> = {
  success: 3500,
  info: 4500,
  error: 7000,
};

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastVariant, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    // Brief leave animation, then remove.
    setToasts((t) =>
      t.map((x) => (x.id === id ? { ...x, leaving: true } : x)),
    );
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      150,
    );
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-(MAX_VISIBLE - 1)), { id, variant, message }]);
      setTimeout(() => dismiss(id), DURATION[variant]);
    },
    [dismiss],
  );

  // Stable API object so consumers don't re-render on every toast.
  const apiRef = useRef<ToastApi>({
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  });
  // push is stable (useCallback with stable dep), so the ref body stays valid.

  return (
    <ToastContext.Provider value={apiRef.current}>
      {children}
      {/* Above modals (z 50/60) per the project z-index rule for popups. */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))] pointer-events-none">
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg text-sm transition-all duration-150",
                STYLES[t.variant],
                t.leaving ? "opacity-0 translate-y-1" : "opacity-100",
              )}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 leading-snug">{t.message}</div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Render-safe fallback (e.g. a component used outside AppShell): log
    // instead of crashing — feedback is non-critical by design.
    return {
      success: (m) => console.log("[toast]", m),
      error: (m) => console.error("[toast]", m),
      info: (m) => console.log("[toast]", m),
    };
  }
  return ctx;
}
