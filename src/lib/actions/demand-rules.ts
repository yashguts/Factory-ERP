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

export interface FormulaConditions {
  drive_type?: string[];
  door_type?: string[];
  capacity?: string[];
  min_floors?: number;
  max_floors?: number;
}
export type CompiledRuleDraft =
  | {
      kind: "component";
      child: { id: string; code: string; name: string };
      parent: { id: string; code: string; name: string };
      qty: number;
      restatement: string;
      confidence: "high" | "medium" | "low";
      note: string | null;
    }
  | {
      kind: "job";
      target: { id: string; code: string; name: string };
      driver: "per_job" | "per_floor";
      factor: number;
      conditions: FormulaConditions;
      restatement: string;
      confidence: "high" | "medium" | "low";
      note: string | null;
    };
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
        "Report the parsed demand rule. kind='component' when demand is driven by another ITEM (child_item_id required per parent_item_id, qty each). kind='job' when demand is driven by the JOB itself (target_item_id required factor× per job [driver=per_job] or per floor [driver=per_floor], optionally filtered by conditions). Use item ids returned by search_items.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["component", "job"] },
          child_item_id: { type: "string", description: "component: the item that is required" },
          parent_item_id: { type: "string", description: "component: the item it is required per" },
          qty: { type: "number", description: "component: child qty per one parent" },
          target_item_id: { type: "string", description: "job: the item that is required" },
          driver: { type: "string", enum: ["per_job", "per_floor"], description: "job: per whole job, or per floor" },
          factor: { type: "number", description: "job: qty per job, or per floor (e.g. '1 per 4 floors' -> 0.25)" },
          conditions: {
            type: "object",
            additionalProperties: false,
            properties: {
              drive_type: { type: "array", items: { type: "string", enum: ["MRL", "BELT", "HOME", "MR", "HYD", "CANTI"] } },
              door_type: { type: "array", items: { type: "string" } },
              capacity: { type: "array", items: { type: "string" } },
              min_floors: { type: "number" },
              max_floors: { type: "number" },
            },
          },
          restatement: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string" },
        },
        required: ["kind", "restatement", "confidence"],
      },
    },
  ];
  const system = `Convert a plain-English manufacturing demand rule into a structured rule for an elevator-parts ERP. There are two kinds:

1) COMPONENT (kind='component') — demand driven by ANOTHER ITEM: "for every demanded PARENT item, also need QTY of the CHILD item." e.g. "2 guide shoes per safety frame" -> child=guide shoe, parent=safety frame, qty=2.

2) JOB (kind='job') — demand driven by the JOB itself, not a specific item: "for each job [matching conditions], need factor× of TARGET item" (driver=per_job), or "per floor" (driver=per_floor; convert "1 per 4 floors" to factor 0.25). e.g. "1 controller stand per MRL job" -> target=controller stand, driver=per_job, conditions.drive_type=["MRL"]. "1 buffer per 4 floors" -> target=buffer, driver=per_floor, factor=0.25.

drive_type values are exactly: MRL, BELT, HOME, MR, HYD, CANTI (Machine-Room-Less, Belt, Home/villa, Machine-Room geared, Hydraulic, Cantilever). door_type/capacity are free text matched loosely against the job.

Resolve every item to a real catalog item using search_items (search a few times; best match by name). Then call report_rule ONCE with the right kind + fields, a one-line restatement, and your confidence. If unsure, still report with confidence "low" + a note.`;

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
      const restatement = String(inp.restatement ?? "");
      const confidence = (inp.confidence as "high" | "medium" | "low") ?? "low";
      const note = inp.note ? String(inp.note) : null;

      if (inp.kind === "job") {
        const targetId = String(inp.target_item_id ?? "");
        const { data: items } = await supabase.from("items").select("id, code, name").in("id", [targetId].filter(Boolean));
        const t = (items ?? [])[0] as Record<string, unknown> | undefined;
        if (!t) return { ok: false, error: "Couldn't match the item to your catalog — name it more exactly." };
        const factor = Number(inp.factor);
        if (!Number.isFinite(factor) || factor <= 0) return { ok: false, error: "Couldn't read a valid quantity/factor for that rule." };
        const driver: "per_job" | "per_floor" = inp.driver === "per_floor" ? "per_floor" : "per_job";
        const c = (inp.conditions as Record<string, unknown>) ?? {};
        const arr = (x: unknown) => (Array.isArray(x) ? x.map((v) => String(v)).filter(Boolean) : undefined);
        const conditions: FormulaConditions = {};
        const dt = arr(c.drive_type); if (dt) conditions.drive_type = dt;
        const dr = arr(c.door_type); if (dr) conditions.door_type = dr;
        const cap = arr(c.capacity); if (cap) conditions.capacity = cap;
        if (c.min_floors != null) conditions.min_floors = Number(c.min_floors);
        if (c.max_floors != null) conditions.max_floors = Number(c.max_floors);
        return {
          ok: true,
          draft: {
            kind: "job",
            target: { id: t.id as string, code: t.code as string, name: t.name as string },
            driver,
            factor,
            conditions,
            restatement,
            confidence,
            note,
          },
        };
      }

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
          kind: "component",
          child: { id: child.id as string, code: child.code as string, name: child.name as string },
          parent: { id: parent.id as string, code: parent.code as string, name: parent.name as string },
          qty,
          restatement,
          confidence,
          note,
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

/* ------------------------------------------------------------------ *
 * Job-type / per-floor demand formulas (demand_formulas). The Phase-2 model:
 * demand driven by the JOB (per job, or per floor) + conditions, not by a parent
 * item. Applied additively in getMrpData (addDemandFormulaDemand).
 * ------------------------------------------------------------------ */

export interface DemandFormulaRow {
  id: string;
  target_item_id: string;
  target_code: string;
  target_name: string;
  driver: "per_job" | "per_floor";
  factor: number;
  conditions: FormulaConditions;
  summary: string;
  note: string | null;
}

function formulaSummary(driver: string, factor: number, conditions: FormulaConditions): string {
  const per = driver === "per_floor" ? "per floor" : "per job";
  const conds: string[] = [];
  if (conditions.drive_type?.length) conds.push(conditions.drive_type.join("/"));
  if (conditions.door_type?.length) conds.push(conditions.door_type.join("/"));
  if (conditions.capacity?.length) conds.push(conditions.capacity.join("/"));
  if (conditions.min_floors != null) conds.push(`≥${conditions.min_floors} floors`);
  if (conditions.max_floors != null) conds.push(`≤${conditions.max_floors} floors`);
  const where = conds.length ? ` · ${conds.join(", ")} jobs` : " · all jobs";
  return `${factor} ${per}${where}`;
}

export async function getDemandFormulas(): Promise<DemandFormulaRow[]> {
  const supabase = createCacheClient();
  const { data: rows } = await supabase
    .from("demand_formulas")
    .select("id, target_item_id, driver, factor, conditions, note")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  const list = (rows ?? []) as Record<string, unknown>[];
  if (!list.length) return [];
  const ids = [...new Set(list.map((r) => r.target_item_id as string))];
  const { data: items } = await supabase.from("items").select("id, code, name").in("id", ids);
  const byId = new Map((items ?? []).map((i: Record<string, unknown>) => [i.id as string, i]));
  return list.map((r) => {
    const it = byId.get(r.target_item_id as string);
    const driver = r.driver as "per_job" | "per_floor";
    const factor = Number(r.factor);
    const conditions = (r.conditions as FormulaConditions) ?? {};
    return {
      id: r.id as string,
      target_item_id: r.target_item_id as string,
      target_code: (it?.code as string) ?? "—",
      target_name: (it?.name as string) ?? "—",
      driver,
      factor,
      conditions,
      summary: formulaSummary(driver, factor, conditions),
      note: (r.note as string | null) ?? null,
    };
  });
}

export async function createDemandFormula(input: {
  targetItemId: string;
  driver: "per_job" | "per_floor";
  factor: number;
  conditions: FormulaConditions;
  sourceText?: string | null;
  note?: string | null;
}): Promise<DemandRuleResult> {
  if (!input.targetItemId) return { ok: false, error: "Pick the item this rule demands." };
  if (input.driver !== "per_job" && input.driver !== "per_floor") return { ok: false, error: "Invalid rule driver." };
  if (!Number.isFinite(input.factor) || input.factor <= 0) return { ok: false, error: "Quantity must be greater than 0." };
  const supabase = await createClient();
  const { error } = await supabase.from("demand_formulas").insert({
    target_item_id: input.targetItemId,
    driver: input.driver,
    factor: input.factor,
    conditions: input.conditions ?? {},
    source_text: input.sourceText?.trim() || null,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateDemand();
  return { ok: true };
}

export async function deleteDemandFormula(id: string): Promise<DemandRuleResult> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  const { error } = await supabase.from("demand_formulas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateDemand();
  return { ok: true };
}
