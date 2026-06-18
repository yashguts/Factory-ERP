"use server";

/* ------------------------------------------------------------------ *
 * Factory ERP assistant — conversational, READ-ONLY.
 *
 * Answers the team's questions about live data by letting Claude call a small
 * set of read tools (each wraps an existing cached server action), then writing
 * a concise answer. No mutations — guarded write-actions come in a later phase.
 * Reuses the same ANTHROPIC_API_KEY + Messages API as the drawing autofill.
 * ------------------------------------------------------------------ */

import { searchItems } from "@/lib/actions/items";
import { getInventoryHealth } from "@/lib/actions/inventory-health";
import { getMrpData } from "@/lib/actions/mrp";
import { searchOperations } from "@/lib/actions/operations";

const MODEL = "claude-opus-4-8";
const MAX_STEPS = 5;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export type AskResult =
  | { ok: true; answer: string; toolsUsed: string[] }
  | { ok: false; error: string };

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "search_items",
    description:
      "Look up inventory items by name or code. Returns each item's code, name, current total stock, unit, category, and make/trade.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "name or code to search" } },
      required: ["query"],
    },
  },
  {
    name: "inventory_health",
    description:
      "Stock health snapshot: per-warehouse balances, how many items are negative (with the worst 10), how many raw sheets sit outside the Raw Material Store, and how many dispatches/program-runs never posted to stock.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "material_shortfall",
    description:
      "Items short of stock for the current job demand (MRP). Optionally filter to 'make' (manufactured) or 'trade' (purchased). Returns the most-short items.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { section: { type: "string", enum: ["make", "trade"] } },
    },
  },
  {
    name: "find_programs",
    description: "Find CNC / assembly programs (recipes) by name or code.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_items": {
      const items = await searchItems(String(input?.query ?? ""), undefined, 15);
      return items.map((i) => ({
        code: i.code,
        name: i.name,
        stock: i.total_stock,
        uom: i.uom_abbreviation,
        category: i.category_name,
        make_trade: i.effective_procurement_type,
      }));
    }
    case "inventory_health": {
      const h = await getInventoryHealth();
      return {
        warehouses: h.warehouses,
        negative_balances: h.totalNegative,
        misplaced_raw_sheets: h.misplacedSheets.count,
        dispatches_not_posted: h.unpostedDispatches.count,
        runs_not_posted: h.unpostedRuns.count,
        worst_negatives: h.negatives.slice(0, 10),
      };
    }
    case "material_shortfall": {
      const section = input?.section === "make" || input?.section === "trade" ? input.section : undefined;
      const rows = await getMrpData();
      const short = rows
        .filter((r) => r.shortfall > 0 && (!section || r.procurement_type === section))
        .sort((a, b) => b.shortfall - a.shortfall)
        .slice(0, 40)
        .map((r) => ({
          code: r.item_code,
          name: r.item_name,
          required: r.total_required,
          stock: r.total_stock,
          shortfall: r.shortfall,
          type: r.procurement_type,
        }));
      return { count: short.length, items: short };
    }
    case "find_programs": {
      const names = await searchOperations(String(input?.query ?? ""));
      return { programs: names.slice(0, 20) };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

const SYSTEM = `You are the assistant for "Factory ERP", an elevator-manufacturing ERP (inventory, BOMs, job orders, MRP, CNC/assembly programs, procurement) used by a factory team in India.

Answer questions about their LIVE data by calling the provided read-only tools, then giving a short, factual answer. Always use a tool rather than guessing numbers. Quantities are in each item's own unit. If a tool returns nothing relevant, say so plainly. You can READ data but cannot make changes yet — if asked to change something, explain what you found and that edits aren't enabled here.

Keep answers concise and practical: a sentence or two, plus a compact bullet list or small table when listing items. Don't dump raw JSON.`;

export async function askAssistant(messages: ChatMessage[]): Promise<AskResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "The assistant isn't configured (missing API key)." };
  if (!messages?.length) return { ok: false, error: "Ask a question to get started." };

  const convo: { role: "user" | "assistant"; content: unknown }[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolsUsed: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, tools: TOOLS, messages: convo }),
      });
    } catch {
      return { ok: false, error: "Couldn't reach the AI service — try again." };
    }
    if (!resp.ok) {
      if (resp.status === 429) return { ok: false, error: "AI is busy — try again in a moment." };
      if (resp.status === 401) return { ok: false, error: "AI key was rejected." };
      return { ok: false, error: `AI request failed (${resp.status}).` };
    }
    const data = (await resp.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
    const blocks = data.content ?? [];
    convo.push({ role: "assistant", content: blocks });

    if (data.stop_reason === "tool_use") {
      const toolResults = [];
      for (const b of blocks) {
        if (b.type === "tool_use" && b.name) {
          toolsUsed.push(b.name);
          let result: unknown;
          try {
            result = await runTool(b.name, b.input ?? {});
          } catch (e) {
            result = { error: e instanceof Error ? e.message : "tool failed" };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: b.id,
            content: JSON.stringify(result).slice(0, 12000),
          });
        }
      }
      convo.push({ role: "user", content: toolResults });
      continue;
    }

    const text = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { ok: true, answer: text || "(no answer)", toolsUsed: [...new Set(toolsUsed)] };
  }
  return { ok: false, error: "That needed too many steps — please narrow the question." };
}
