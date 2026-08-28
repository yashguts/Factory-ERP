"use server";

/**
 * Handwritten daily run sheet -> drafted Program Runs, via Claude vision.
 *
 * A photo of the operator's paper log (program names/codes + how many sheets
 * each ran) is read into rows, and every row is matched against AUDITED
 * programs only — the model is given the real audited catalog and its answer
 * is validated against it, so it cannot invent a program. Nothing is written
 * to the DB here: the user reviews the draft (fix matches, adjust counts,
 * untick rows) and records through the normal recordRun path, which is what
 * posts stock with the cutover gate and idempotency guards.
 *
 * Mirrors the cabin-sketch autofill pattern (cabin-autofill.ts): the ONLY
 * key-dependent piece; reads ANTHROPIC_API_KEY; absent -> graceful
 * { ok:false, reason:'not_configured' }, never throws.
 */

import { createCacheClient } from "@/lib/supabase/cache-client";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { AuditedProgramHit } from "@/lib/actions/operation-runs";

// Opus 4.8 — the fallback this file always documented, promoted 2026-08-28
// after the Sonnet 5 + `thinking: {type:"disabled"}` request began returning
// 400s. On Opus 4.8, omitting `thinking` runs WITHOUT thinking, so the forced
// tool call and the full max_tokens budget need no special flag at all (the
// disabled flag existed only because Sonnet 5 defaults to adaptive thinking).
const MODEL = "claude-opus-4-8";
// Bounded so a slow read can't let the serverless platform kill the function.
const VISION_TIMEOUT_MS = 40_000;

/* ------------------------------------------------------------------ *
 * Result contract (consumed by the run-sheet reader UI)
 * ------------------------------------------------------------------ */

export interface RunSheetDraftRow {
  /** The line exactly as the model read it off the sheet. */
  as_written: string;
  /** Sheets/runs counted on that line. */
  qty: number;
  confidence: "high" | "medium" | "low";
  /** Validated audited program, or null when unmatched. */
  match: AuditedProgramHit | null;
  /** Up to 3 catalog candidates for unmatched / uncertain rows. */
  suggestions: AuditedProgramHit[];
  /** An entry for this program already logged on this date, if any. */
  existing: { run_id: string; runs_count: number } | null;
}

export interface RunSheetDraft {
  rows: RunSheetDraftRow[];
  /** A date written on the sheet itself, if legible (ISO yyyy-mm-dd). */
  sheet_date_seen: string | null;
  notes: string;
  /** EVERY run already logged on this date, keyed by operation id — so the
   *  review UI can re-show the "already logged" badge when the user swaps a
   *  row's program to one the AI didn't match. */
  existing_by_operation: Record<string, { run_id: string; runs_count: number }>;
}

export type RunSheetResult =
  | { ok: true; data: RunSheetDraft }
  | { ok: false; error: string; reason?: "not_configured" };

/* ------------------------------------------------------------------ *
 * Vision extraction
 * ------------------------------------------------------------------ */

interface SheetRow {
  as_written: string;
  program_code: string | null;
  qty: number;
  confidence: "high" | "medium" | "low";
}
interface SheetExtraction {
  rows: SheetRow[];
  sheet_date: string | null;
  notes: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          as_written: {
            type: "string",
            description:
              "The program identifier EXACTLY as handwritten on that line (do not normalise).",
          },
          program_code: {
            type: ["string", "null"],
            description:
              "The matching CODE copied character-for-character from the AUDITED PROGRAM CATALOG, or null if no confident match. NEVER write a code that is not in the catalog.",
          },
          qty: {
            type: "integer",
            minimum: 1,
            description:
              "Sheets/runs counted for that line (digits, 'x3', '3 nos', or tally marks).",
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["as_written", "program_code", "qty", "confidence"],
      },
    },
    sheet_date: {
      type: ["string", "null"],
      description: "A date written on the sheet, as ISO yyyy-mm-dd, else null.",
    },
    notes: {
      type: "string",
      description:
        "Anything else useful: struck-through lines skipped, unreadable rows, a shift/operator heading.",
    },
  },
  required: ["rows", "sheet_date", "notes"],
} as const;

const SYSTEM_PROMPT = `You read HANDWRITTEN factory run sheets from an Indian elevator factory and call report_run_sheet exactly once. The sheet is a day's log of which CNC programs ran and how many sheets each cut. Lines look like a program identifier followed by a count.

HOW PROGRAMS ARE WRITTEN — operators abbreviate. The identifier may be:
- a full code ("CNC-121A"), a bare number ("121A", "121-A", "121 A") which means the CNC- code with that number,
- a partial program name ("car door panel", "swing frame"),
- mixed English/Hindi handwriting.
You are given the complete AUDITED PROGRAM CATALOG (one "CODE | NAME" per line). For each handwritten line pick the catalog entry it means and copy its CODE exactly into program_code. If several catalog entries are plausible or the writing is unreadable, set program_code to null and confidence low — DO NOT guess a code that is not clearly right, and NEVER output a code that is not in the catalog.

QTY — the count after the identifier: plain digits, "x3", "3 nos", or tally marks. Skip struck-through lines and ignore any grand-total row. Default 1 only when a line clearly ran but shows no count.

Also read any date written on the sheet (sheet_date, ISO). Put skipped/unreadable lines in notes. Report EVERY program line — do not merge repeated lines; list each as its own row.`;

async function callVision(
  b64: string,
  mediaType: string,
  catalogText: string,
  apiKey: string,
): Promise<SheetExtraction | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        // No `thinking` param: Opus 4.8 runs without thinking when it's
        // omitted, so the whole max_tokens budget goes to the rows and the
        // forced tool call needs no thinking-disable flag.
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tool_choice: { type: "tool", name: "report_run_sheet" },
        tools: [
          {
            name: "report_run_sheet",
            description:
              "Report the handwritten run sheet as structured rows matched to the audited program catalog.",
            input_schema: SCHEMA,
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: b64 },
              },
              {
                type: "text",
                text: `AUDITED PROGRAM CATALOG (the ONLY codes you may output):\n${catalogText}\n\nRead the run sheet photo completely and call report_run_sheet.`,
              },
            ],
          },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch {
    return {
      error: ctrl.signal.aborted
        ? "Reading the sheet took too long — try again."
        : "Couldn't reach the sheet-reading service.",
    };
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    if (resp.status === 429) return { error: "AI is busy — try again in a moment." };
    if (resp.status === 401) return { error: "AI key rejected — check the Anthropic API key." };
    // Surface the API's own error message — a bare status code turns every
    // failure into a guessing game (the lesson of the 2026-08-28 400s).
    let detail = "";
    try {
      const body = (await resp.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? "";
      console.error("run-sheet vision API error", resp.status, JSON.stringify(body));
    } catch {
      /* body unreadable — keep the status-only message */
    }
    return {
      error: `AI sheet-reading failed (${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ""}).`,
    };
  }
  const data = (await resp.json()) as {
    content?: Array<{ type: string; input?: unknown }>;
    stop_reason?: string;
  };
  // A truncated tool call would LOOK complete but be missing tail rows — the
  // operator would record an incomplete day believing it was all read.
  if (data.stop_reason === "max_tokens")
    return {
      error:
        "The sheet has too many lines to read in one pass — photograph it in two halves and read each separately.",
    };
  const tool = data.content?.find((b) => b.type === "tool_use");
  if (!tool?.input)
    return {
      error:
        data.stop_reason === "refusal"
          ? "The model declined to read this photo."
          : "Could not read a run list from the photo.",
    };
  return tool.input as SheetExtraction;
}

/* ------------------------------------------------------------------ *
 * Catalog + fuzzy fallback (mirrors searchAuditedPrograms' token AND)
 * ------------------------------------------------------------------ */

function toks(s: string): string[] {
  return s
    .toLowerCase()
    // Glue a mirror-pair suffix to its number: "436 A" / "436-A" -> "436a",
    // matching how catalog codes tokenize ("CNC-436A" -> "436a"). Without
    // this the "a" is dropped and 436 vs 436A can't be told apart.
    .replace(/(\d)\s*[-\s]\s*([a-z])(?![a-z0-9])/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

/** Candidates containing EVERY token of the handwritten label, fewest extras first. */
function fuzzyCandidates(label: string, catalog: AuditedProgramHit[], limit = 3): AuditedProgramHit[] {
  const req = toks(label);
  if (!req.length) return [];
  return catalog
    .map((p) => {
      const cand = new Set(toks(`${p.code ?? ""} ${p.name}`));
      for (const t of req) if (!cand.has(t)) return null;
      return { p, extras: cand.size - req.length };
    })
    .filter((x): x is { p: AuditedProgramHit; extras: number } => x !== null)
    .sort((a, b) => a.extras - b.extras)
    .slice(0, limit)
    .map((x) => x.p);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function draftRunsFromSheet(
  imageBase64: string,
  mediaType: string,
  runDate: string,
): Promise<RunSheetResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return {
      ok: false,
      error: "Run-sheet reading isn't configured (no AI key).",
      reason: "not_configured",
    };
  if (!imageBase64 || !runDate)
    return { ok: false, error: "Missing photo or date." };

  const supabase = createCacheClient();

  // The full audited catalog (643 today) + the day's already-logged runs —
  // independent reads, one round-trip wave.
  const [catalog, existingRes] = await Promise.all([
    fetchAllRanged<AuditedProgramHit>((from, to, withCount) =>
      supabase
        .from("operations")
        .select("id, code, name, machine, machining_time_seconds", withCount ? { count: "exact" } : {})
        .eq("is_active", true)
        .not("audited_at", "is", null)
        .order("code")
        .range(from, to),
    ),
    supabase
      .from("operation_runs")
      .select("id, operation_id, runs_count")
      .eq("run_date", runDate),
  ]);
  if (!catalog.length)
    return { ok: false, error: "No audited programs exist yet — audit programs first." };
  // The "already logged today" safeguard depends on this read — a silently
  // empty map would present logged programs as fresh and invite double counts.
  if (existingRes.error)
    return { ok: false, error: "Couldn't check today's existing runs — try again." };

  const catalogText = catalog
    .map((p) => `${p.code ?? "(no code)"} | ${p.name}`)
    .join("\n");

  const extraction = await callVision(imageBase64, mediaType, catalogText, apiKey);
  if ("error" in extraction) return { ok: false, error: extraction.error };

  const byCode = new Map<string, AuditedProgramHit>();
  for (const p of catalog) if (p.code) byCode.set(p.code.trim().toUpperCase(), p);
  const existingByOp = new Map<string, { run_id: string; runs_count: number }>();
  for (const r of existingRes.data ?? [])
    existingByOp.set(r.operation_id as string, {
      run_id: r.id as string,
      runs_count: Number(r.runs_count) || 0,
    });

  const rows: RunSheetDraftRow[] = (extraction.rows ?? []).map((r) => {
    // Bounded both ways: a misread "2026" (a year, a job number) must not
    // become 2,026 runs of stock movement. 999 is far above any real day.
    const qty = Math.min(999, Math.max(1, Math.round(Number(r.qty) || 1)));
    // Anti-hallucination gate: only a code that exists in the audited catalog
    // counts as a match, no matter what the model claimed.
    let match = r.program_code ? byCode.get(r.program_code.trim().toUpperCase()) ?? null : null;
    let confidence = r.confidence ?? "low";
    let suggestions: AuditedProgramHit[] = [];
    if (!match) {
      suggestions = fuzzyCandidates(r.as_written, catalog);
      // A single all-token candidate is safe to pre-fill — still reviewed.
      if (suggestions.length === 1) {
        match = suggestions[0];
        confidence = "medium";
        suggestions = [];
      } else {
        confidence = "low";
      }
    }
    return {
      as_written: String(r.as_written ?? "").slice(0, 200),
      qty,
      confidence,
      match,
      suggestions,
      existing: match ? existingByOp.get(match.id) ?? null : null,
    };
  });

  if (!rows.length)
    return { ok: false, error: "No program lines could be read from the photo." };

  const existing_by_operation: Record<string, { run_id: string; runs_count: number }> = {};
  for (const [opId, e] of existingByOp) existing_by_operation[opId] = e;

  return {
    ok: true,
    data: {
      rows,
      sheet_date_seen: extraction.sheet_date ?? null,
      notes: extraction.notes ?? "",
      existing_by_operation,
    },
  };
}
