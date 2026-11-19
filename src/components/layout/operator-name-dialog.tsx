"use client";

import { useEffect, useRef, useState } from "react";
import { UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  subscribeOperatorNameRequests,
  type OperatorNameRequest,
} from "@/lib/jobs/operator-prompt";

/**
 * The app's "what's your name?" pop-up — replaces the browser's window.prompt().
 *
 * There is no login in this app, so each device remembers a name and stamps it
 * on what that person does (uploads, audits, releases, stock changes). Mounted
 * ONCE in AppShell; any component asks for it through useOperator().
 *
 * It often opens on top of another dialog (e.g. "Release job"), so it sits
 * above the standard Modal layer and keeps Esc to itself — otherwise one Esc
 * would also close the dialog underneath and lose what was typed there.
 */
export function OperatorNameDialog() {
  const [req, setReq] = useState<OperatorNameRequest | null>(null);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      subscribeOperatorNameRequests((r) => {
        setReq(r);
        if (r) setName(r.current ?? "");
      }),
    [],
  );

  const isChange = !!req?.current;
  const trimmed = name.trim();
  const canSave = trimmed.length >= 2;

  useEffect(() => {
    if (!req) return;
    // Focus (and select, when changing) after the open animation has painted.
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase + stop: the Modal underneath must not see this Esc.
      e.stopPropagation();
      req.resolve(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [req]);

  if (!req) return null;

  const save = () => {
    if (canSave) req.resolve(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operator-name-title"
    >
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in"
        onClick={() => req.resolve(null)}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="relative w-full max-w-sm overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-xl)] animate-scale-in"
      >
        <button
          type="button"
          onClick={() => req.resolve(null)}
          aria-label="Close"
          className="absolute right-3 top-3 cursor-pointer rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <X size={16} />
        </button>

        <div className="px-6 pb-5 pt-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]">
            <UserRound size={22} strokeWidth={1.75} />
          </div>

          <h2 id="operator-name-title" className="mt-4 text-lg font-semibold leading-tight">
            {isChange ? "Change your name" : "What's your name?"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">
            {isChange
              ? "This is the name recorded against what you do on this device."
              : "There is no login here, so your name is recorded against what you do — uploads, audits, releases and stock changes."}
          </p>
          {req.forAction && (
            <p className="mt-3 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs font-medium text-[var(--warning)]">
              Your name is required. Without it, the action you just started will not go ahead.
            </p>
          )}

          <label
            htmlFor="operator-name-input"
            className="mb-1.5 mt-5 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]"
          >
            Your name
          </label>
          <Input
            id="operator-name-input"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your full name"
            maxLength={60}
            autoComplete="name"
            spellCheck={false}
          />
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Saved on this device only. You can change it any time from the bottom of the sidebar.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--muted)]/40 px-6 py-3">
          {isChange ? (
            <button
              type="button"
              onClick={() => req.resolve("")}
              className="cursor-pointer text-xs font-medium text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
            >
              Remove my name
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => req.resolve(null)}>
              {req.forAction ? "Cancel action" : "Cancel"}
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {isChange ? "Save" : "Save and continue"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
