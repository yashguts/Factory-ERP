"use server";

/**
 * Blend engine — turns a job into a Part List DRAFT (no DB writes; the engineer
 * reviews, then Save persists). Blends, per line:
 *   - the job's hand-entered BOM (job-specific truth, read-only),
 *   - the brain's prediction from spec + the live drawing read,
 * with full provenance + conflict flags. Never the sole backbone — the engineer
 * arbitrates. BOM is READ ONLY; all writes happen later via savePackingList.
 */
import { createClient } from "@/lib/supabase/server";
import { getAllCategories } from "@/lib/actions/categories";
import { buildCategorySectionMap, OTHER_SECTION_KEY } from "@/lib/packing-list/helpers";
import { PACKING_SECTIONS, packingSection, sectionApplies } from "@/lib/packing-list/packing-list-sections";
import { CABIN_TYPES } from "@/lib/cabin/cabin-types";
import { predictPartList, type PredictSpec } from "@/lib/partlist/predict";
import { buildResolver, type ItemLite } from "@/lib/partlist/resolve";
import sectionGroups from "@/lib/partlist/section-groups.json";
import overridesRaw from "@/lib/partlist/partlist-overrides.json";
import type { DraftLine, PartListDraft, UnmappedBom } from "@/lib/partlist/types";

const NON_INVENTORY = new Set(
  Object.entries(overridesRaw as Record<string, { nonInventory?: boolean }>)
    .filter(([, o]) => o.nonInventory).map(([k]) => k),
);

/** Shape of the cached drawing extraction (job_drawing_extractions.extracted). */
interface RichLike {
  door_type?: { value?: string | null } | null;
  capacity?: { value?: string | null } | null;
  floors?: { value?: number | null } | null;
  dimensions?: {
    travel_mm?: { value?: string | null } | null;
    door_opening_width_mm?: { value?: string | null } | null;
  } | null;
}

const GROUPS = sectionGroups as Record<string, string>;
const TEMPLATE_ORDER = new Map(PACKING_SECTIONS.map((s, i) => [s.key, i]));
const QTY_TOL = 0.5;

function num(s: unknown): number | null {
  const m = String(s ?? "").replace(/[, ]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function parseCapacity(c: string | null): { capPass: number | null; capKg: number | null } {
  const s = (c || "").toUpperCase();
  const p = s.match(/(\d+)\s*PASS/), k = s.match(/(\d+)\s*KG/);
  return { capPass: p ? +p[1] : null, capKg: k ? +k[1] : null };
}
function mapDoorErp(d: string | null): string | null {
  if (!d) return null;
  const M: Record<string, string> = { COL: "COLLAPSIBLE", MT: "MT", CO: "CO", AT: "AT", AFF: "AFF", BYPART: "CO", SWS: "SWING", DUMB: "DUMB" };
  return M[d.toUpperCase()] || d.toUpperCase();
}
function mapDoorDrawing(s: string | null): string | null {
  const l = (s || "").toLowerCase();
  if (!l) return null;
  if (/collaps/.test(l)) return "COLLAPSIBLE";
  if (/swing/.test(l)) return "SWING";
  if (/four|aff/.test(l)) return "AFF";
  if (/manual|\bmt\b/.test(l)) return "MT";
  if (/\bat\b|auto.*telesc|telescop/.test(l)) return "AT";
  if (/centre|center|\bco\b|auto/.test(l)) return "CO";
  return null;
}

function flat<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

async function fetchActiveItems(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ItemLite[]> {
  const PAGE = 1000;
  const { count } = await supabase.from("items").select("id", { count: "exact", head: true }).eq("is_active", true);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  // fire all page queries concurrently (was sequential — ~9 round trips serialised)
  const chunks = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase.from("items").select("id, code, name, category_id").eq("is_active", true).range(i * PAGE, i * PAGE + PAGE - 1),
    ),
  );
  const out: ItemLite[] = [];
  for (const c of chunks) { if (c.error) throw c.error; out.push(...((c.data ?? []) as ItemLite[])); }
  return out;
}

export async function generatePartListDraft(jobId: string): Promise<PartListDraft> {
  const supabase = await createClient();
  const warnings: string[] = [];

  // --- job spec ---
  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_number, floors, drive_type, capacity, door_type, gad_drawing_url")
    .eq("id", jobId)
    .single();
  if (!job) throw new Error("Job not found");

  const cap = parseCapacity(job.capacity);
  const drive = (job.drive_type || "").toUpperCase() || null;
  const target: PredictSpec = {
    stops: job.floors ?? null,
    capPass: cap.capPass,
    capKg: cap.capKg,
    doorType: mapDoorErp(job.door_type),
    driveType: drive,
    home: drive === "HOME",
    goods: (cap.capKg ?? 0) >= 2000,
    v3f: drive === "V3F" || drive === "MV3F",
    travelMm: null,
  };

  // --- drawing features from the CACHED extraction (fast; no inline vision call,
  //     which would blow the serverless timeout). The drawing is read+cached by the
  //     existing AI auto-fill / readJobDrawing; here we just reuse what's stored. ---
  let drawingRead = false;
  if (job.gad_drawing_url) {
    const { data: ext } = await supabase
      .from("job_drawing_extractions")
      .select("extracted")
      .eq("job_id", jobId)
      .order("extracted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const d = ext?.extracted as RichLike | null;
    if (d) {
      drawingRead = true;
      const travel = num(d?.dimensions?.travel_mm?.value);
      if (travel) target.travelMm = travel;
      const dDoor = mapDoorDrawing(d?.door_type?.value ?? null);
      if (dDoor) target.doorType = dDoor; // drawing wins (vision reads door at ~100%)
      if (target.capPass == null && target.capKg == null) {
        const c2 = parseCapacity(d?.capacity?.value ?? null);
        target.capPass = c2.capPass; target.capKg = c2.capKg;
      }
      if (target.stops == null && d?.floors?.value != null) target.stops = d.floors.value;
      const dw = num(d?.dimensions?.door_opening_width_mm?.value);
      if (dw) target.doorWidthMm = dw;
    } else {
      warnings.push("Drawing not read yet — run AI auto-fill on this job to read the drawing, then regenerate for travel-based quantities. Using spec + BOM for now.");
    }
  } else {
    warnings.push("No drawing uploaded — quantities use spec-based estimates.");
  }
  if (target.doorType == null) warnings.push("Door type unknown — prediction is less precise; confirm door-specific lines.");
  if (target.stops == null) warnings.push("Stops/floors unknown — quantities cannot be scaled; confirm each.");

  // --- brain prediction ---
  const brain = predictPartList(target);
  const brainBySection = new Map<string, (typeof brain.lines)[number]>();
  for (const l of brain.lines) if (l.sectionKey) brainBySection.set(l.sectionKey, l);

  // --- BOM (read-only) → sections via the existing category map ---
  const cats = await getAllCategories();
  const catToSection = buildCategorySectionMap(cats);
  const { data: header } = await supabase.from("job_bom_headers").select("id").eq("job_id", jobId).limit(1).maybeSingle();
  type BomEntry = { id: string; item_id: string | null; code: string | null; name: string | null; qty: number };
  const bomBySection = new Map<string, BomEntry[]>();
  const unmapped: UnmappedBom[] = [];
  const unmappedEntries: BomEntry[] = [];
  let bomTotal = 0;
  if (header) {
    const { data: bom } = await supabase
      .from("job_bom_lines")
      .select(`id, category, required_quantity, item_id, item:items!job_bom_lines_item_id_fkey(id, code, name, category_id)`)
      .eq("job_bom_id", header.id);
    for (const r of bom ?? []) {
      bomTotal++;
      const it = flat(r.item) as { id: string; code: string; name: string; category_id: string | null } | null;
      const sk = it?.category_id ? catToSection.get(it.category_id) : undefined;
      const entry = { id: r.id as string, item_id: (r.item_id as string) ?? null, code: it?.code ?? null, name: it?.name ?? null, qty: Number(r.required_quantity ?? 0) };
      if (sk && sk !== OTHER_SECTION_KEY) {
        const arr = bomBySection.get(sk) ?? []; arr.push(entry); bomBySection.set(sk, arr);
      } else {
        unmapped.push({ id: entry.id, category: (r.category as string) || "(uncategorised)", item_name: entry.name, item_code: entry.code, qty: entry.qty });
        unmappedEntries.push(entry);
      }
    }
  }

  // --- resolver over all active items ---
  const items = await fetchActiveItems(supabase);
  const resolver = buildResolver(items, cats);

  // --- merge per section ---
  const sectionKeys = new Set<string>([...brainBySection.keys(), ...bomBySection.keys()]);
  const lines: DraftLine[] = [];
  for (const sk of sectionKeys) {
    const sec = packingSection(sk);
    if (!sec) continue; // unknown key (e.g. "other") — coverage handles it
    const brainLine = brainBySection.get(sk);
    const bomList = bomBySection.get(sk);
    // Drive/door gating: skip a predicted-only line when it doesn't apply to this
    // job (e.g. an R1000-only or Collapsible-only line). BOM lines are truth — kept.
    if (!(bomList && bomList.length) && !sectionApplies(sec, drive, target.doorType ?? null)) continue;
    // 'fixed' (pinned) lines behave as item lines downstream — the distinction
    // lives in PackingSection and is resolved below.
    const captureType: "item" | "free" = sec.captureType === "free" ? "free" : "item";
    const group = GROUPS[sk] || "PART E";

    if (bomList && bomList.length) {
      // ONE draft line per BOM item — never collapse. Every BOM line must appear
      // in the Part List (the owner's hard rule). When a single BOM item lands in
      // a section it confirms the predicted particular, so blend the rule's spec/qty
      // onto it; when several land in one section they're distinct parts, each its
      // own line (rule spec doesn't apply across them).
      const ruleForSection = bomList.length === 1 ? brainLine : undefined;
      for (const bl of bomList) {
        const sources = ["BOM"];
        let is_conflict = false, conflict_note: string | null = null;
        if (ruleForSection) {
          sources.push("rule");
          if (ruleForSection.qty > 0 && bl.qty > 0 && Math.abs(ruleForSection.qty - bl.qty) > QTY_TOL) {
            is_conflict = true; conflict_note = `BOM qty ${bl.qty} vs predicted ${ruleForSection.qty}`;
          }
        }
        lines.push({
          sectionKey: sk, label: sec.label, group, captureType,
          item_id: bl.item_id, item_code: bl.code, item_name: bl.name,
          spec: ruleForSection?.specs[0] ?? null, qty: bl.qty || ruleForSection?.qty || 0,
          source: sources.join(" + "), confidence: "high", is_conflict, conflict_note,
          needs_item: false, non_inventory: false, bom_line_id: bl.id,
        });
      }
    } else if (brainLine) {
      const spec = brainLine.specs[0] ?? null;
      let item_id: string | null = null, item_code: string | null = null, item_name: string | null = null;
      // skip resolution for sections research flagged as genuinely non-inventory
      if (captureType === "item" && !NON_INVENTORY.has(sk)) {
        const r = resolver.resolve(sec.label, sk, spec);
        if (r.item) { item_id = r.item.id; item_code = r.item.code; item_name = r.item.name; }
      }
      const non_inventory = NON_INVENTORY.has(sk) && !item_id;
      const needs_item = captureType === "item" && !item_id && !non_inventory;
      lines.push({
        sectionKey: sk, label: sec.label, group, captureType,
        item_id, item_code, item_name, spec, qty: brainLine.qty,
        source: NON_INVENTORY.has(sk) ? "rule (non-stock)" : brainLine.source,
        confidence: captureType === "free" || item_id ? brainLine.confidence : "low",
        is_conflict: false, conflict_note: null, needs_item, non_inventory, bom_line_id: null,
      });
    }
  }

  // Pinned ("fixed") sections: pre-fill the exact inventory item by name when the
  // line applies to this job and isn't already present (e.g. Tension Spring HOME,
  // Door Closer). No search needed — the item is the line.
  const present = new Set(lines.map((l) => l.sectionKey));
  const itemByName = new Map(items.map((it) => [it.name.trim().toLowerCase(), it]));
  for (const sec of PACKING_SECTIONS) {
    if (sec.captureType !== "fixed" || !sec.pinnedItem || present.has(sec.key)) continue;
    if (!sectionApplies(sec, drive, target.doorType ?? null)) continue;
    const it = itemByName.get(sec.pinnedItem.trim().toLowerCase());
    lines.push({
      sectionKey: sec.key, label: sec.label, group: GROUPS[sec.key] || "PART E", captureType: "item",
      item_id: it?.id ?? null, item_code: it?.code ?? null, item_name: it?.name ?? null,
      spec: sec.specHint || null, qty: 0, source: "pinned", confidence: it ? "high" : "low",
      is_conflict: false, conflict_note: null, needs_item: !it, non_inventory: false, bom_line_id: null,
    });
  }

  // Cabin Items: pull the linked Cabin Job's panels (matched by job_number) into
  // the "Cabin Panels (from Cabin Job)" line, ordered by cabin type then sort_order.
  // The cabin type shows in the spec column so the packer can tell panels apart.
  if (job.job_number) {
    const { data: cabinJob } = await supabase
      .from("cabin_jobs").select("id").ilike("job_number", job.job_number).maybeSingle();
    if (cabinJob) {
      const { data: cl } = await supabase
        .from("cabin_job_lines")
        .select(`cabin_type, qty, sort_order, item:items!cabin_job_lines_item_id_fkey(id, code, name)`)
        .eq("cabin_job_id", cabinJob.id);
      const order = new Map(CABIN_TYPES.map((t, i) => [t as string, i]));
      const sorted = (cl ?? []).slice().sort((a, b) =>
        ((order.get(a.cabin_type as string) ?? 99) - (order.get(b.cabin_type as string) ?? 99)) ||
        (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)));
      for (const l of sorted) {
        const it = flat(l.item) as { id: string; code: string | null; name: string | null } | null;
        lines.push({
          sectionKey: "p-cabin-from-job", label: it?.name ?? "(cabin item)",
          group: GROUPS["p-cabin-from-job"] || "Cabin Items", captureType: "item",
          item_id: it?.id ?? null, item_code: it?.code ?? null, item_name: it?.name ?? null,
          spec: (l.cabin_type as string) ?? null, qty: Number(l.qty ?? 0) || 1, source: "Cabin Job",
          confidence: it ? "high" : "low", is_conflict: false, conflict_note: null,
          needs_item: !it, non_inventory: false, bom_line_id: null,
        });
      }
    }
  }

  // Unmapped BOM items → an "Unsorted (from BOM)" group so NO BOM line is ever
  // dropped. Each is linked + flagged so the engineer files it before marking ready.
  for (const e of unmappedEntries) {
    lines.push({
      sectionKey: OTHER_SECTION_KEY, label: e.name || "(BOM item)", group: "OTHER", captureType: "item",
      item_id: e.item_id, item_code: e.code, item_name: e.name, spec: null, qty: e.qty,
      source: "BOM", confidence: "high", is_conflict: true,
      conflict_note: "Couldn't auto-place — file into a section", needs_item: false, non_inventory: false, bom_line_id: e.id,
    });
  }

  lines.sort((a, b) => (TEMPLATE_ORDER.get(a.sectionKey) ?? 9999) - (TEMPLATE_ORDER.get(b.sectionKey) ?? 9999));

  if (!brain.matchedDoor && target.doorType) warnings.push("No rule template for this door type yet — showing core particulars only; the BOM fills the door-specific parts.");

  return {
    lines,
    coverage: { total: bomTotal, covered: bomTotal - unmapped.length, unmapped },
    drawingRead,
    doorType: target.doorType ?? null,
    warnings,
  };
}
