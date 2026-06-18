"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Loader2, User, Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { askAssistant, type ChatMessage } from "@/lib/actions/assistant";

interface Turn extends ChatMessage {
  tools?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "What's short for Make right now?",
  "How healthy is our inventory?",
  "What's the stock of guide rail 9X65X70?",
  "Which programs cut P2C-350?",
];

export function AssistantClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        ? { role: "assistant", content: res.answer, tools: res.toolsUsed }
        : { role: "assistant", content: res.error, error: true },
    ]);
    setPending(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
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
              It reads your live inventory, MRP, programs and stock health to answer. It can&rsquo;t make changes yet.
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
