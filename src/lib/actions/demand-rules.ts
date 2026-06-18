"use server";

/* ------------------------------------------------------------------ *
 * Demand formula rules (item_demand_rules) — the "where does demand come
 * from?" editor. A rule says: for every demanded unit of PARENT, also demand
 * `qty` of CHILD (e.g. 4 guide shoes per safety frame). These are DEMAND-ONLY
 * (folded into MRP's reqMap; the production plan never sees them). Until now the
 * table was read-only (SQL-inserted); this adds create/delete so the team can
 * define formulas for items that have no direct job-BOM demand.
 * ------------------------------------------------------------------ */

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidateTag, revalidatePath } from "next/cache";
import { searchItems } from "@/lib/actions/items";

export interface DemandRuleRow {
  id: string;
  parent_item_id: string;
  parent_code: string;
  parent_name: string;
  qty: number;
  note: string | null;
}
export type DemandRuleResult = { ok: true } | { ok: false; error: string };

/** Rules by which THIS item (the child) acquires demand — one per parent. */
export async function getDemandRulesForChild(childItemId: string): Promise<DemandRuleRow[]> {
  if (!childItemId) return [];
  const supabase = createCacheClient();
  const { data: rules } = await supabase
    .from("item_demand_rules")
    .select("id, parent_item_id, qty, note")
    .eq("child_item_id", childItemId);
  const list = (rules ?? []) as Record<string, unknown>[];
  if (!list.length) return [];
  const parentIds = [...new Set(list.map((r) => r.parent_item_id as string))];
  const { data: parents } = await supabase.from("items").select("id, code, name").in("id", parentIds);
  const byId = new Map((parents ?? []).map((p: Record<string, unknown>) => [p.id as string, p]));
  return list.map((r) => {
    const p = byId.get(r.parent_item_id as string);
    return {
      id: r.id as string,
      parent_item_id: r.parent_item_id as string,
      parent_code: (p?.code as string) ?? "—",
      parent_name: (p?.name as string) ?? "—",
      qty: Number(r.qty),
      note: (r.note as string | null) ?? null,
    };
  });
}

function revalidateDemand() {
  for (const t of ["items", "inventory-stock", "bom-lines"]) revalidateTag(t);
  revalidatePath("/demand");
  revalidatePath("/inventory");
  revalidatePath("/mrp");
  revalidatePath("/mrp/trade");
}

export async function createDemandRule(input: {
  childItemId: string;
  parentItemId: string;
  qty: number;
  note?: string | null;
}): Promise<DemandRuleResult> {
  const { childItemId, parentItemId, qty } = input;
  if (!childItemId || !parentItemId) return { ok: false, error: "Pick both the item and the parent it's demanded per." };
  if (parentItemId === childItemId) return { ok: false, error: "An item can't be demanded per itself." };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Quantity must be greater than 0." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("item_demand_rules")
    .select("id")
    .eq("child_item_id", childItemId)
    .eq("parent_item_id", parentItemId)
    .limit(1);
  if (existing && existing.length)
    return { ok: false, error: "A rule for this item + parent already exists — delete it first to change the quantity." };

  const { error } = await supabase.from("item_demand_rules").insert({
    child_item_id: childItemId,
    parent_item_id: parentItemId,
    qty,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateDemand();
  return { ok: true };
}

export async function deleteDemandRule(id: string): Promise<DemandRuleResult> {
  if (!id) return { ok: false, error: "Missing rule id." };
  const supabase = await createClient();
  const { error } = await supabase.from("item_demand_rules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateDemand();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * AI rule compiler — plain English -> a validated component rule draft.
 * The AI resolves both items from the live catalog (search_items tool) and
 * reports child/parent/qty; we VALIDATE the ids server-side (no hallucinated
 * items) and return a draft for the user to confirm before saving. Compiles to
 * the structured rule — it never computes demand live.
 * ------------------------------------------------------------------ */

const AI_MODEL = "claude-opus-4-8";

export interface CompiledRuleDraft {
  child: { id: string; code: string; name: string };
  parent: { id: string; code: string; name: string };
  qty: number;
  restatement: string;
  confidence: "high" | "medium" | "low";
  note: string | null;
}
export type CompileResult = { ok: true; draft: CompiledRuleDraft } | { ok: false; error: string };

interface Blk {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export async function compileDemandRule(text: string): Promise<CompileResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "The AI rule reader isn't configured." };
  const q = text?.trim();
  if (!q) return { ok: false, error: "Type a rule to interpret." };

  const supabase = createCacheClient();
  const tools = [
    {
      name: "search_items",
      description: "Search the inventory catalog by name/code; returns candidate items (id, code, name, category) to choose from.",
      input_schema: { type: "object", additionalProperties: false, properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "report_rule",
      description:
        "Report the parsed demand rule. child_item_id = the item that is REQUIRED; parent_item_id = the item it is required PER; qty = how many child per one parent. Use ids returned by search_items.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          child_item_id: { type: "string" },
          parent_item_id: { type: "string" },
          qty: { type: "number" },
          restatement: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string" },
        },
        required: ["child_item_id", "parent_item_id", "qty", "restatement", "confidence"],
      },
    },
  ];
  const system = `Convert a plain-English manufacturing demand rule into a structured COMPONENT rule for an elevator-parts ERP. The rule means: for every demanded unit of the PARENT item, the factory also needs QTY of the CHILD item. Example: "2 guide shoes per safety frame" -> child = guide shoe, parent = safety frame, qty = 2. Resolve BOTH items to real catalog items using search_items (search a few times if needed; pick the best match by name). Then call report_rule once with the chosen item ids, the qty, a one-line restatement, and your confidence. If an item can't be found confidently, still call report_rule with your best guess, confidence "low", and a note explaining the ambiguity.`;

  const convo: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: q }];
  for (let step = 0; step < 5; step++) {
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: 1024, system, tools, messages: convo }),
      });
    } catch {
      return { ok: false, error: "Couldn't reach the AI service — try again." };
    }
    if (!resp.ok)
      return { ok: false, error: resp.status === 401 ? "AI key rejected." : resp.status === 429 ? "AI busy — try again in a moment." : `AI request failed (${resp.status}).` };
    const data = (await resp.json()) as { content?: Blk[]; stop_reason?: string };
    const blocks = data.content ?? [];
    convo.push({ role: "assistant", content: blocks });

    const report = blocks.find((b) => b.type === "tool_use" && b.name === "report_rule");
    if (report) {
      const inp = report.input ?? {};
      const childId = String(inp.child_item_id ?? "");
      const parentId = String(inp.parent_item_id ?? "");
      const { data: items } = await supabase.from("items").select("id, code, name").in("id", [childId, parentId].filter(Boolean));
      const byId = new Map((items ?? []).map((i: Record<string, unknown>) => [i.id as string, i]));
      const child = byId.get(childId);
      const parent = byId.get(parentId);
      if (!child || !parent) return { ok: false, error: "Couldn't match that to real catalog items — name the items more exactly." };
      if (childId === parentId) return { ok: false, error: "That resolved to the same item on both sides — please rephrase." };
      const qty = Number(inp.qty);
      if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Couldn't read a valid quantity — say e.g. '2 X per Y'." };
      return {
        ok: true,
        draft: {
          child: { id: child.id as string, code: child.code as string, name: child.name as string },
          parent: { id: parent.id as string, code: parent.code as string, name: parent.name as string },
          qty,
          restatement: String(inp.restatement ?? ""),
          confidence: (inp.confidence as "high" | "medium" | "low") ?? "low",
          note: inp.note ? String(inp.note) : null,
        },
      };
    }

    if (data.stop_reason === "tool_use") {
      const results = [];
      for (const b of blocks) {
        if (b.type === "tool_use" && b.name === "search_items") {
          const items = await searchItems(String(b.input?.query ?? ""), undefined, 12);
          results.push({
            type: "tool_result",
            tool_use_id: b.id,
            content: JSON.stringify(items.map((i) => ({ id: i.id, code: i.code, name: i.name, category: i.category_name }))).slice(0, 8000),
          });
        } else if (b.type === "tool_use") {
          results.push({ type: "tool_result", tool_use_id: b.id, content: "unknown tool" });
        }
      }
      if (results.length) {
        convo.push({ role: "user", content: results });
        continue;
      }
    }
    break;
  }
  return { ok: false, error: "The AI couldn't turn that into a rule — try the form '2 <item> per <item>'." };
}
