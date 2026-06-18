"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Loader2, User, Wrench, Check, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { askAssistant, type ChatMessage, type ActionProposal } from "@/lib/actions/assistant";
import { createDemandRule, createDemandFormula } from "@/lib/actions/demand-rules";
import { recordRun } from "@/lib/actions/operation-runs";
import { useToast } from "@/components/ui/toast";

type ProposalState = "pending" | "saving" | "done" | "dismissed";

interface Turn extends ChatMessage {
  tools?: string[];
  error?: boolean;
  proposal?: ActionProposal;
  proposalState?: ProposalState;
  proposalMsg?: string;
}

/** A one-line, human-readable summary of what a proposal will do. */
function proposalSummary(p: ActionProposal): string {
  if (p.kind === "program_run") {
    return `Log program run — ${p.program_name}${p.program_code ? ` (${p.program_code})` : ""} × ${p.runs_count} on ${p.run_date}. This will consume its input sheets and produce its outputs in stock.`;
  }
  const d = p.draft;
  if (d.kind === "component") {
    return `Add demand rule — ${d.qty} × ${d.child.name} (${d.child.code}) per ${d.parent.name} (${d.parent.code}).`;
  }
  const per = d.driver === "per_floor" ? "per floor" : "per job";
  return `Add demand formula — ${d.factor} ${per} of ${d.target.name} (${d.target.code}). ${d.restatement}`;
}

const SUGGESTIONS = [
  "What's short for Make right now?",
  "How healthy is our inventory?",
  "What's the stock of guide rail 9X65X70?",
  "Which programs cut P2C-350?",
  "What cabin parts are short?",
  "Dispatch status for job <number>",
  "Add a rule: 2 guide shoes per safety frame",
  "Log 1 run of <program> today",
];

export function AssistantClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const history: ChatMessage[] = [...turns.map((t) => ({ role: t.role, content: t.content })), { role: "user", content: q }];
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setInput("");
    setPending(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    const res = await askAssistant(history);
    setTurns((prev) => [
      ...prev,
      res.ok
        ? {
            role: "assistant",
            content: res.answer,
            tools: res.toolsUsed,
            proposal: res.proposal,
            proposalState: res.proposal ? "pending" : undefined,
          }
        : { role: "assistant", content: res.error, error: true },
    ]);
    setPending(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
  };

  const setProposal = (i: number, patch: Partial<Turn>) =>
    setTurns((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  /** Execute a drafted proposal — only on the user's explicit click. */
  const confirmProposal = async (i: number, p: ActionProposal) => {
    setProposal(i, { proposalState: "saving" });
    let res: { ok: boolean; error?: string };
    if (p.kind === "program_run") {
      res = await recordRun({
        operation_id: p.operation_id,
        run_date: p.run_date,
        runs_count: p.runs_count,
        note: "Logged via assistant",
      });
    } else if (p.draft.kind === "component") {
      res = await createDemandRule({
        childItemId: p.draft.child.id,
        parentItemId: p.draft.parent.id,
        qty: p.draft.qty,
        note: p.draft.note,
      });
    } else {
      res = await createDemandFormula({
        targetItemId: p.draft.target.id,
        driver: p.draft.driver,
        factor: p.draft.factor,
        conditions: p.draft.conditions,
        sourceText: p.draft.restatement,
        note: p.draft.note,
      });
    }
    if (res.ok) {
      toast.success(p.kind === "program_run" ? "Program run logged." : "Demand rule saved.");
      setProposal(i, { proposalState: "done", proposalMsg: "Saved." });
    } else {
      toast.error(res.error || "Couldn't save.");
      setProposal(i, { proposalState: "pending", proposalMsg: res.error || "Couldn't save — try again." });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <PageHeader
        icon={<Sparkles size={18} />}
        title="Assistant"
        meta="Ask about inventory, shortfalls, programs — answered from live data (read-only)"
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
        {turns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Sparkles className="h-8 w-8 text-[var(--muted-foreground)] mb-3" />
            <p className="text-sm font-medium">Ask the factory anything</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-sm">
              It reads your live inventory, MRP, programs, stock health, cabin demand, procurement and dispatch. It can also draft a demand rule or log a program run for you to confirm.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={t.role === "user" ? "max-w-[80%]" : "max-w-[85%] w-full"}>
                <div className="flex items-center gap-1.5 mb-1 text-[11px] text-[var(--muted-foreground)]">
                  {t.role === "user" ? <User size={12} /> : <Sparkles size={12} />}
                  {t.role === "user" ? "You" : "Assistant"}
                  {t.tools && t.tools.length > 0 && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <Wrench size={11} /> {t.tools.join(", ")}
                    </span>
                  )}
                </div>
                <div
                  className={
                    t.role === "user"
                      ? "rounded-lg px-3 py-2 text-sm bg-[var(--primary)]/10 text-[var(--foreground)]"
                      : t.error
                        ? "rounded-lg px-3 py-2 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] border border-[var(--destructive-border)]"
                        : "rounded-lg px-3 py-2 text-sm bg-[var(--muted)]/50 text-[var(--foreground)] whitespace-pre-wrap"
                  }
                >
                  {t.content}
                </div>
                {t.proposal && t.proposalState && (
                  <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                    <div className="flex items-start gap-2">
                      {t.proposalState === "done" ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />
                      ) : (
                        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                      )}
                      <div className="flex-1">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                          {t.proposalState === "done" ? "Saved" : "Proposed change — review &amp; confirm"}
                        </div>
                        <div className="mt-0.5">{proposalSummary(t.proposal)}</div>
                        {t.proposal.kind === "demand_rule" && t.proposal.draft.confidence !== "high" && t.proposalState !== "done" && (
                          <div className="mt-1.5 flex items-center gap-1 text-xs text-[var(--warning)]">
                            <AlertTriangle size={12} /> {t.proposal.draft.confidence} confidence — double-check the items before confirming.
                          </div>
                        )}
                        {t.proposalMsg && t.proposalState === "pending" && (
                          <div className="mt-1 text-xs text-[var(--destructive)]">{t.proposalMsg}</div>
                        )}
                      </div>
                    </div>
                    {(t.proposalState === "pending" || t.proposalState === "saving") && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => confirmProposal(i, t.proposal!)}
                          disabled={t.proposalState === "saving"}
                        >
                          {t.proposalState === "saving" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Confirm &amp; save
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setProposal(i, { proposalState: "dismissed" })}
                          disabled={t.proposalState === "saving"}
                        >
                          <X className="h-3.5 w-3.5" /> Dismiss
                        </Button>
                      </div>
                    )}
                    {t.proposalState === "dismissed" && (
                      <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">Dismissed — nothing was saved.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask about stock, shortfalls, programs…  (Enter to send, Shift+Enter for a new line)"
          className="flex-1 resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] max-h-32"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !input.trim()}>
          {pending ? <Loader2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
