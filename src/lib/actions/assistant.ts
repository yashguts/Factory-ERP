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
import { getCabinRequirements } from "@/lib/actions/cabin-program-plan";
import { getProcurementData } from "@/lib/actions/procurement";
import { getJobDispatchSummary } from "@/lib/actions/dispatch";
import { createCacheClient } from "@/lib/supabase/cache-client";

const flat = <T>(rel: unknown): T | null =>
  Array.isArray(rel) ? ((rel[0] ?? null) as T | null) : ((rel as T) ?? null);
const safeLike = (s: string) => s.replace(/[%,()]/g, "");

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
  {
    name: "get_job",
    description:
      "Get a job order by its number or customer name. Returns the elevator spec, status/stage, dispatch count, and its FULL bill of materials — every BOM line (section/category, item code, item name, required quantity).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "job number or customer name" } },
      required: ["query"],
    },
  },
  {
    name: "list_jobs",
    description: "List the most recent job orders with customer, status, stage and required dispatch date.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "cabin_requirements",
    description:
      "Cabin parts demanded by cabin jobs vs stock: per item the cabin type, finish, required qty, stock and shortfall (how many are short). Returns the most-short cabin items.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "procurement_on_order",
    description:
      "Purchasing / on-order status: per item the qty still on order (ordered minus received), already received, total ordered and supplier(s), plus the number of open purchase orders. Returns the items with the most on order.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "job_dispatch_status",
    description:
      "Dispatch status for a job: per BOM line how much is required, dispatched and remaining, plus the number of dispatch events. Look up the job by its number or customer name.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "job number or customer name" } },
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
    case "get_job": {
      const supabase = createCacheClient();
      const q = safeLike(String(input?.query ?? "").trim());
      if (!q) return { found: false };
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, job_number, customer_name, spec_string, status, stage, floors, drive_type, capacity, requirement_dispatch_date")
        .or(`job_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
        .limit(3);
      if (!jobs?.length) return { found: false };
      const out = [];
      for (const j of jobs as Record<string, unknown>[]) {
        const { data: hdr } = await supabase
          .from("job_bom_headers")
          .select("id")
          .eq("job_id", j.id as string)
          .limit(1)
          .maybeSingle();
        let bom: { category: unknown; code: string | null; name: string | null; required: unknown }[] = [];
        if (hdr) {
          const { data: lines } = await supabase
            .from("job_bom_lines")
            .select("category, required_quantity, item:items!job_bom_lines_item_id_fkey(code,name)")
            .eq("job_bom_id", (hdr as Record<string, unknown>).id as string)
            .order("sort_order")
            .limit(300);
          bom = (lines ?? []).map((l: Record<string, unknown>) => {
            const it = flat<{ code: string; name: string }>(l.item);
            return { category: l.category, code: it?.code ?? null, name: it?.name ?? null, required: l.required_quantity };
          });
        }
        const { count } = await supabase
          .from("job_dispatches")
          .select("id", { count: "exact", head: true })
          .eq("job_id", j.id as string);
        out.push({
          job_number: j.job_number,
          customer: j.customer_name,
          spec: j.spec_string,
          status: j.status,
          stage: j.stage,
          floors: j.floors,
          drive_type: j.drive_type,
          capacity: j.capacity,
          required_dispatch_date: j.requirement_dispatch_date,
          dispatches: count ?? 0,
          bom_line_count: bom.length,
          bom_lines: bom,
        });
      }
      return { jobs: out };
    }
    case "list_jobs": {
      const supabase = createCacheClient();
      const { data } = await supabase
        .from("jobs")
        .select("job_number, customer_name, status, stage, requirement_dispatch_date")
        .order("created_at", { ascending: false })
        .limit(30);
      return { jobs: data ?? [] };
    }
    case "cabin_requirements": {
      const rows = await getCabinRequirements();
      const anyShort = rows.some((r) => r.shortfall > 0);
      const picked = (anyShort ? rows.filter((r) => r.shortfall > 0) : rows)
        .sort((a, b) => b.shortfall - a.shortfall)
        .slice(0, 30)
        .map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          finish: r.finish,
          required: r.required,
          stock: r.stock,
          shortfall: r.shortfall,
          job_count: r.job_count,
        }));
      return { count: picked.length, any_shortfall: anyShort, items: picked };
    }
    case "procurement_on_order": {
      const data = await getProcurementData();
      const items = [...data.byItem]
        .sort((a, b) => b.on_order - a.on_order)
        .slice(0, 30)
        .map((r) => ({
          code: r.code,
          name: r.name,
          on_order: r.on_order,
          received: r.received,
          ordered: r.ordered,
          suppliers: r.suppliers,
        }));
      const openPos = data.orders.filter((o) => o.status === "draft" || o.status === "ordered").length;
      return { open_purchase_orders: openPos, items };
    }
    case "job_dispatch_status": {
      const supabase = createCacheClient();
      const q = safeLike(String(input?.query ?? "").trim());
      if (!q) return { found: false };
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, job_number, customer_name")
        .or(`job_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
        .limit(3);
      if (!jobs?.length) return { found: false };
      const best = jobs[0] as { id: string; job_number: string; customer_name: string };
      const summary = await getJobDispatchSummary(best.id);
      const lines = summary.lines.slice(0, 40).map((l) => ({
        item_name: l.item_name,
        required: l.required,
        dispatched: l.dispatched,
        remaining: l.remaining,
      }));
      const out: Record<string, unknown> = {
        found: true,
        job_number: best.job_number,
        customer: best.customer_name,
        dispatch_events: summary.dispatches.length,
        line_count: summary.lines.length,
        lines,
      };
      if (jobs.length > 1) {
        out.other_matches = (jobs as { job_number: string; customer_name: string }[])
          .slice(1)
          .map((j) => ({ job_number: j.job_number, customer: j.customer_name }));
      }
      return out;
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

const SYSTEM = `You are the assistant for "Factory ERP", an elevator-manufacturing ERP (inventory, BOMs, job orders, MRP, CNC/assembly programs, procurement) used by a factory team in India.

Answer questions about their LIVE data by calling the provided read-only tools, then giving a short, factual answer. You can see inventory and stock health, material shortfalls (MRP), CNC/assembly programs, jobs and their bills of materials, cabin-part demand and shortfall, procurement & on-order quantities, and a job's dispatch status (required / dispatched / remaining per line). Always use a tool rather than guessing numbers. Quantities are in each item's own unit. If a tool returns nothing relevant, say so plainly. You can READ data but cannot make changes yet — if asked to change something, explain what you found and that edits aren't enabled here.

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
