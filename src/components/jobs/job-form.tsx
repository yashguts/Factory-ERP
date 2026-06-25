"use client";

import { useState, useCallback, useTransition, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Loader2, Plus, Check, Copy, Columns2, PanelRightClose, Sparkles } from "lucide-react";
import { BOM_SECTIONS, PHASE_ORDER } from "@/lib/bom/bom-sections";
import type { BomSection } from "@/lib/bom/bom-sections";
import { shouldRenderSection } from "@/lib/bom/section-gating";
import { ItemPickerSection } from "@/components/jobs/item-picker-section";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import { CategoryPickerModal } from "@/components/jobs/category-picker-modal";
import { JobTemplatePickerModal } from "@/components/jobs/job-template-picker-modal";
import { type ApplyPayload } from "@/components/jobs/autofill-review-modal";
import { AutofillContextPanel } from "@/components/jobs/autofill-context-panel";
import type { AppliedSuggestion, AutofillResult } from "@/components/jobs/autofill-types";
import { autofillFromDrawing, captureSuggestionOutcome } from "@/lib/actions/job-autofill";
import { useToast } from "@/components/ui/toast";
import { GadDrawingPanel } from "@/components/jobs/gad-drawing-panel";
import {
  JobDetailsPanel,
  ElevatorSpecPanel,
} from "@/components/jobs/job-form-panels";
import {
  createJob,
  updateJob,
  saveBomSection,
  getJobTemplate,
} from "@/lib/actions/jobs";
import type { BomLineInput } from "@/lib/actions/jobs";
import { readOperator } from "@/lib/jobs/use-operator";
import { checkCategoryPaths } from "@/lib/actions/categories";
import type { Job, JobStage, StructureIncluded } from "@/lib/supabase/types";

/** Flat line returned by getJobBomItemLines (server). */
export interface ExistingItemLine {
  category: string;
  variant: string | null;
  value_text: string | null;
  required_quantity: number;
  item_id: string | null;
  item: {
    code: string;
    name: string;
    uom: { abbreviation: string } | null;
  } | null;
}

/** State keyed by section category → array of picked items. */
type PickerState = Record<string, PickedItem[]>;

/** Phase label for user-added ad-hoc sections. */
const AD_HOC_PHASE = "Additional Items";

const rid = () => Math.random().toString(36).slice(2);
const SPEC_KEYS = ["drive_type", "floors", "capacity", "door_finish", "brand"] as const;

/**
 * Turn an autofill result into the apply payload — EVERY suggested row (including
 * low-confidence, flagged via `confidence`), plus the spec, plus the learning trace.
 * No review gate: the form itself is the review surface (the owner's call).
 */
function buildAutofillPayload(data: AutofillResult): ApplyPayload {
  const spec: ApplyPayload["spec"] = {};
  const applied: AppliedSuggestion[] = [];
  if (data.spec) {
    for (const key of SPEC_KEYS) {
      const cell = data.spec[key];
      if (!cell || cell.value == null) continue;
      if (key === "floors") spec.floors = Number(cell.value);
      else (spec as Record<string, unknown>)[key] = cell.value;
      applied.push({ kind: "spec", field: key, suggested_value: String(cell.value), suggested_qty: null, confidence: cell.confidence, provenance: [] });
    }
  }
  const sections: Record<string, PickedItem[]> = {};
  for (const l of data.bom) {
    (sections[l.section] ??= []).push({
      _key: rid(),
      item_id: l.item_id,
      item_code: l.item_code,
      item_name: l.item_name,
      item_lookup: null,
      uom: l.uom,
      category_name: null,
      required_quantity: l.suggestedQty,
      confidence: l.confidenceBand,
    });
    applied.push({ kind: "bom_line", field: l.section, suggested_value: l.item_id, suggested_qty: l.suggestedQty, confidence: l.confidenceBand, provenance: l.supportingJobs });
  }
  return { spec, sections, applied };
}

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  mode: "create" | "edit";
  job?: Job;
  /** All BOM lines (item-based) for this job. Used to seed the picker. */
  existingItemLines?: ExistingItemLine[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function JobForm({ mode, job, existingItemLines }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Job tracking ──────────────────────────────────────────────────
  const [savedJobId, setSavedJobId] = useState<string | null>(
    job?.id ?? null,
  );
  // In edit mode, treat every phase as already-saved on mount — data is
  // in DB. Picker / spec changes will mark phases dirty as the user edits.
  const [savedPhases, setSavedPhases] = useState<Record<string, boolean>>(
    () => {
      if (mode !== "edit") return {};
      const map: Record<string, boolean> = {};
      for (const phase of PHASE_ORDER) map[phase] = true;
      return map;
    },
  );
  const [savingPhase, setSavingPhase] = useState<string | null>(null);
  const [jobSaved, setJobSaved] = useState(mode === "edit");

  // ── Job metadata ──────────────────────────────────────────────────
  // Only the fields the spec keeps. Other DB columns (door_finish, brand,
  // order_date, expected_delivery, remark, door_type) are no longer
  // editable from this form — they stay untouched on existing jobs
  // because buildJobData omits them entirely.
  const [jobNumber, setJobNumber] = useState(job?.job_number ?? "");
  const [customerName, setCustomerName] = useState(
    job?.customer_name ?? "",
  );
  // Optional contact mobile. Kept as a digits-only string; the input strips
  // non-digits and caps length at 10, so the only invalid state is a partial
  // (1–9 digit) entry, which mobileError flags below.
  const [mobileNumber, setMobileNumber] = useState(job?.mobile_number ?? "");
  const [location, setLocation] = useState(job?.location ?? "");
  const [stage, setStage] = useState<JobStage>(job?.stage ?? "new");
  // New jobs start at "new" (not pulled into MRP until advanced). There is no
  // blank option — "Required" is always one of the three stages.
  const [requirementStage, setRequirementStage] = useState<JobStage>(
    job?.requirement_stage ?? "new",
  );
  const [requirementDispatchDate, setRequirementDispatchDate] = useState(
    job?.requirement_dispatch_date ?? "",
  );

  // ── Elevator spec (controls which BOM sections are visible) ──────
  const [floors, setFloors] = useState<number | "">(job?.floors ?? "");
  const [driveType, setDriveType] = useState(job?.drive_type ?? "");
  const [capacity, setCapacity] = useState(job?.capacity ?? "");
  const [structureIncluded, setStructureIncluded] = useState<StructureIncluded>(
    job?.structure_included ?? "NA",
  );

  // ── Split view + GAD drawing ──────────────────────────────────────
  // When ON, BOM form goes to the left half and the drawing panel to
  // the right. Each pane has its own scroll container so they're
  // independent. Auto-enabled when a drawing already exists on edit.
  const [splitView, setSplitView] = useState<boolean>(
    !!job?.gad_drawing_url,
  );

  // ── Picker state ──────────────────────────────────────────────────
  const initialPickerState = useMemo((): PickerState => {
    const state: PickerState = {};
    if (!existingItemLines) return state;
    for (const line of existingItemLines) {
      if (!line.item_id || !line.item) continue; // skip variant-only lines
      const arr = state[line.category] ?? [];
      arr.push({
        _key: Math.random().toString(36).slice(2),
        item_id: line.item_id,
        item_code: line.item.code,
        item_name: line.item.name,
        uom: line.item.uom?.abbreviation ?? "",
        category_name: null,
        required_quantity: line.required_quantity,
      });
      state[line.category] = arr;
    }
    return state;
  }, [existingItemLines]);

  const [pickerState, setPickerState] =
    useState<PickerState>(initialPickerState);

  // ── Mapping diagnostics ───────────────────────────────────────────
  // Resolve every hardcoded section's defaultItemCategories against the
  // live category tree on mount. Any section whose paths don't resolve
  // surfaces a "no mapping" warning inline so the user can spot stale
  // bindings instead of seeing a silently-empty section.
  const [resolvedPaths, setResolvedPaths] = useState<Set<string> | null>(null);
  useEffect(() => {
    const allPaths = Array.from(
      new Set(
        BOM_SECTIONS.flatMap((s) => s.defaultItemCategories ?? []),
      ),
    );
    if (allPaths.length === 0) {
      setResolvedPaths(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { resolved } = await checkCategoryPaths(allPaths);
        if (!cancelled) setResolvedPaths(new Set(resolved));
      } catch {
        if (!cancelled) setResolvedPaths(new Set()); // fail open — show all as unmapped rather than crash
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Required-field validation ─────────────────────────────────────
  // Both "Save Details" and any "Save Phase" action must enforce that
  // these fields are filled. Returns a list of human-readable labels of
  // missing fields — empty list means the form is valid.
  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (!jobNumber.trim()) missing.push("Job Number");
    if (!customerName.trim()) missing.push("Customer Name");
    if (!location.trim()) missing.push("Location");
    if (!stage) missing.push("Stage");
    // requirement_stage no longer needs a presence check — the blank option was
    // removed, so it's always one of new / first_phase / full_material.
    if (!requirementDispatchDate) missing.push("Req. Dispatch Date");
    if (!floors) missing.push("Floors");
    if (!driveType) missing.push("Drive Type");
    if (!capacity) missing.push("Capacity");
    return missing;
  }, [
    jobNumber,
    customerName,
    location,
    stage,
    requirementDispatchDate,
    floors,
    driveType,
    capacity,
  ]);
  // Mobile is optional, but if entered it must be exactly 10 digits.
  const mobileError = useMemo(() => {
    if (!mobileNumber) return null;
    return /^[0-9]{10}$/.test(mobileNumber)
      ? null
      : "Mobile Number must be exactly 10 digits";
  }, [mobileNumber]);

  const isFormValid = missingFields.length === 0 && !mobileError;

  // ── Ad-hoc sections (user-added via +Add Section) ─────────────────
  // Each ad-hoc section binds to one inventory category path. Stored on
  // the job by its `category` field — which is the leaf category name.
  // We seed any existing BOM categories that don't match a hardcoded
  // section, so they show up as ad-hoc sections when the user edits.
  type AdHocSection = {
    category: string; // display label + job_bom_lines.category value
    categoryPath: string; // full path for search scoping
  };
  const [adHocSections, setAdHocSections] = useState<AdHocSection[]>(() => {
    if (!existingItemLines) return [];
    const knownCategories = new Set(BOM_SECTIONS.map((s) => s.category));
    const seen = new Set<string>();
    const out: AdHocSection[] = [];
    for (const line of existingItemLines) {
      if (!line.category || seen.has(line.category)) continue;
      if (knownCategories.has(line.category)) continue;
      seen.add(line.category);
      // We don't know the original path; the leaf name is a reasonable
      // default for scoping the search.
      out.push({ category: line.category, categoryPath: line.category });
    }
    return out;
  });

  const [pickerModalOpen, setPickerModalOpen] = useState(false);

  const addAdHocSection = useCallback(
    (sel: { path: string; displayName: string }) => {
      setAdHocSections((prev) => {
        // Use the leaf name as the display label; ensure uniqueness vs
        // hardcoded + existing ad-hoc.
        const usedLabels = new Set<string>([
          ...BOM_SECTIONS.map((s) => s.category),
          ...prev.map((s) => s.category),
        ]);
        let label = sel.displayName;
        let n = 2;
        while (usedLabels.has(label)) {
          label = `${sel.displayName} (${n++})`;
        }
        return [
          ...prev,
          { category: label, categoryPath: sel.path },
        ];
      });
      setPickerModalOpen(false);
    },
    [],
  );

  const removeAdHocSection = useCallback((category: string) => {
    setAdHocSections((prev) => prev.filter((s) => s.category !== category));
    setPickerState((prev) => {
      if (!(category in prev)) return prev;
      const next = { ...prev };
      delete next[category];
      return next;
    });
  }, []);

  // ── Import-from-existing-job (template) ───────────────────────────
  // Lets a user clone the spec + BOM of an existing job into this form.
  // Only meaningful in create mode — hidden in edit mode.
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // ── AI Auto-fill (additive: produces a draft the engineer applies) ──
  const toast = useToast();
  const [autofillPanelOpen, setAutofillPanelOpen] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillResult, setAutofillResult] = useState<AutofillResult | null>(null);
  // The suggestions last applied — graded against the saved BOM on Save.
  const suggestionTrace = useRef<AppliedSuggestion[]>([]);

  const handlePickTemplate = useCallback(
    async (jobId: string, jobNumber: string) => {
      setImporting(true);
      try {
        const { spec, bomLines } = await getJobTemplate(jobId);

        // Spec fields
        if (spec.floors != null) setFloors(spec.floors);
        if (spec.drive_type) setDriveType(spec.drive_type);
        if (spec.capacity) setCapacity(spec.capacity);

        // Build a fresh picker state + collect any ad-hoc sections that
        // appear in the source job's BOM but aren't in BOM_SECTIONS.
        const knownCategories = new Set(BOM_SECTIONS.map((s) => s.category));
        const nextPicker: PickerState = {};
        const adHocByCategory = new Map<string, string>(); // label -> leaf path
        for (const line of bomLines) {
          if (!line.item_id || !line.item) continue;
          if (!knownCategories.has(line.category)) {
            adHocByCategory.set(line.category, line.category);
          }
          const arr = nextPicker[line.category] ?? [];
          arr.push({
            _key: Math.random().toString(36).slice(2),
            item_id: line.item_id,
            item_code: line.item.code,
            item_name: line.item.name,
            item_lookup: line.item.lookup_key ?? null,
            uom: line.item.uom?.abbreviation ?? "",
            category_name: null,
            required_quantity: line.required_quantity,
          });
          nextPicker[line.category] = arr;
        }

        setPickerState(nextPicker);
        setAdHocSections(
          Array.from(adHocByCategory.entries()).map(([label, path]) => ({
            category: label,
            categoryPath: path,
          })),
        );

        // Imported data is dirty until the user saves it.
        setJobSaved(false);
        setSavedPhases({});
        setTemplateModalOpen(false);

        // Light user feedback. Could be a toast later.
        alert(
          `Imported spec and ${bomLines.length} BOM item${
            bomLines.length === 1 ? "" : "s"
          } from ${jobNumber}. Review and adjust as needed, then save.`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Import failed";
        alert(`Could not import from job ${jobNumber}: ${msg}`);
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  // Run AI auto-fill for the saved job: reads the drawing (if a key is set)
  // for the spec, then predicts the BOM from your similar past jobs. Fills the
  // form DIRECTLY (no review popup — the form is the review surface); nothing is
  // saved until the engineer uses the normal Save buttons. The drawing reads +
  // manual-fill hints show in the inline AutofillContextPanel above the BOM.
  const runAutofill = useCallback(() => {
    if (!savedJobId) return;
    setAutofilling(true);
    startTransition(async () => {
      try {
        const res = await autofillFromDrawing(savedJobId, {
          floors: typeof floors === "number" ? floors : null,
          drive_type: driveType || null,
          capacity: capacity || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        applyAutofill(buildAutofillPayload(res.data));
        setAutofillResult(res.data);
        setAutofillPanelOpen(true);
      } catch (err: unknown) {
        // Never let a failed action bubble to the route error boundary — toast it.
        toast.error(err instanceof Error ? err.message : "Auto-fill failed — please try again.");
      } finally {
        setAutofilling(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedJobId, floors, driveType, capacity]);

  // Apply the reviewed draft into the EXISTING form state only — spec setters +
  // picker state + ad-hoc sections. Calls nothing in jobs.ts; the job is NOT
  // mutated by applying. The engineer then uses the normal Save buttons.
  const applyAutofill = useCallback(
    (p: ApplyPayload) => {
      if (p.spec.floors != null) setFloors(p.spec.floors);
      if (p.spec.drive_type) setDriveType(p.spec.drive_type);
      if (p.spec.capacity) setCapacity(p.spec.capacity);
      markSpecChanged();

      // Any suggested category not in BOM_SECTIONS must be registered as an
      // ad-hoc section, or visibleSections won't render it and collectBomLines
      // would silently drop it on save.
      const known = new Set(BOM_SECTIONS.map((s) => s.category));
      const newAdHoc: AdHocSection[] = [];
      for (const cat of Object.keys(p.sections)) {
        if (!known.has(cat)) newAdHoc.push({ category: cat, categoryPath: cat });
      }
      if (newAdHoc.length) {
        setAdHocSections((prev) => {
          const have = new Set(prev.map((s) => s.category));
          return [...prev, ...newAdHoc.filter((s) => !have.has(s.category))];
        });
      }

      setPickerState((prev) => {
        const next = { ...prev };
        for (const [cat, rows] of Object.entries(p.sections)) next[cat] = rows;
        return next;
      });
      setSavedPhases({});
      setJobSaved(false);
      suggestionTrace.current = p.applied;

      const n = Object.values(p.sections).reduce((a, r) => a + r.length, 0) + Object.keys(p.spec).length;
      toast.info(`Filled ${n} suggestions into the form — review, edit, then Save.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Fire-and-forget learning signal: how the applied suggestions fared vs the
  // saved BOM. A plain function (not useCallback) so it can reference
  // visibleSections/collectBomLines declared lower without a TDZ. Never blocks
  // or fails a save (void + caught).
  function captureOutcome(jobId: string) {
    if (!suggestionTrace.current.length) return;
    const finalSpec = buildJobData() as unknown as Record<string, string | number | null>;
    const finalLines = collectBomLines(visibleSections).map((l) => ({
      category: l.category,
      item_id: l.item_id ?? null,
      required_quantity: l.required_quantity ?? 0,
    }));
    void captureSuggestionOutcome(
      jobId,
      job?.gad_drawing_url ?? null,
      suggestionTrace.current,
      finalSpec,
      finalLines,
    ).catch(() => {});
    suggestionTrace.current = [];
  }

  const setPickerItems = useCallback(
    (category: string, items: PickedItem[]) => {
      setPickerState((prevState) => ({ ...prevState, [category]: items }));
      // Clear "Saved" badge for any phase containing this category — picker
      // state diverged from what was last saved. (Ad-hoc sections live in
      // a dedicated phase, so handle that too.)
      const phase =
        BOM_SECTIONS.find((s) => s.category === category)?.phase ??
        AD_HOC_PHASE;
      setSavedPhases((prevPhases) => {
        if (!prevPhases[phase]) return prevPhases;
        const next = { ...prevPhases };
        delete next[phase];
        return next;
      });
    },
    [],
  );

  /**
   * Wrap a spec-field setter so that changing floors/door/drive/capacity
   * also clears all "Saved" phase badges. These fields control which
   * sections render, so any previously-saved phase may no longer reflect
   * what's in DB.
   */
  function markSpecChanged() {
    setJobSaved(false);
    setSavedPhases({});
  }

  // ── Visible sections & grouping ──────────────────────────────────
  // Hardcoded sections (filtered by gates) plus ad-hoc user-added ones,
  // each promoted to a synthetic BomSection so the renderer can treat
  // them uniformly.
  const visibleSections = useMemo<BomSection[]>(() => {
    // Door type is no longer collected in this form (no doorType gates
    // are currently in use); pass null so any future doorType gate
    // defaults to hidden until it's reintroduced.
    const hardcoded = BOM_SECTIONS.filter((s) =>
      shouldRenderSection(s, null, driveType || null),
    );
    const adHoc: BomSection[] = adHocSections.map((s) => ({
      category: s.category,
      phase: AD_HOC_PHASE,
      gate: { kind: "always" },
      defaultItemCategories: [s.categoryPath],
    }));
    return [...hardcoded, ...adHoc];
  }, [driveType, adHocSections]);

  const sectionsByPhase = useMemo(() => {
    const map = new Map<string, BomSection[]>();
    // Standard phases in order
    for (const phase of PHASE_ORDER) {
      const secs = visibleSections.filter((s) => s.phase === phase);
      if (secs.length > 0) map.set(phase, secs);
    }
    // Ad-hoc phase always last
    const adHoc = visibleSections.filter((s) => s.phase === AD_HOC_PHASE);
    if (adHoc.length > 0) map.set(AD_HOC_PHASE, adHoc);
    return map;
  }, [visibleSections]);

  // ── Counts ────────────────────────────────────────────────────────
  // Only count rows that have an actual item picked. Empty placeholder
  // rows (from the new N-row picker UI) don't count.
  const totalPickedItems = useMemo(() => {
    let n = 0;
    for (const section of visibleSections) {
      const rows = pickerState[section.category] ?? [];
      n += rows.filter((r) => r.item_id).length;
    }
    return n;
  }, [pickerState, visibleSections]);

  // ── Save-state derivation ─────────────────────────────────────────
  // The form has unsaved work if: job metadata is dirty (jobSaved=false),
  // OR there's no saved record yet, OR any visible phase isn't in
  // savedPhases. The user can glance at the header to know if their work
  // is committed.
  const allPhasesSaved = useMemo(() => {
    for (const phase of sectionsByPhase.keys()) {
      if (!savedPhases[phase]) return false;
    }
    return true;
  }, [sectionsByPhase, savedPhases]);

  const hasUnsavedChanges =
    !jobSaved ||
    !savedJobId ||
    (totalPickedItems > 0 && !allPhasesSaved);

  // ── Helpers ───────────────────────────────────────────────────────
  function buildSpecString(): string | null {
    const parts = [];
    // `floors` now stores TOTAL STOPS (not the old "G+N"); show "N Stops".
    if (floors) parts.push(`${floors} Stops`);
    if (driveType) parts.push(driveType);
    if (capacity) parts.push(capacity);
    return parts.join("/") || null;
  }

  function buildJobData() {
    // Only send the fields the form actively manages. Other DB columns
    // (door_finish, brand, order_date, expected_delivery, remark,
    // door_type) are intentionally omitted so they stay untouched on
    // existing jobs.
    return {
      job_number: jobNumber.trim(),
      customer_name: customerName.trim() || null,
      mobile_number: mobileNumber.trim() || null,
      location: location.trim() || null,
      spec_string: buildSpecString(),
      floors: floors || null,
      drive_type: driveType || null,
      capacity: capacity || null,
      structure_included: structureIncluded,
      stage,
      requirement_stage: requirementStage,
      requirement_dispatch_date: requirementDispatchDate || null,
    };
  }

  /** Convert picker state for given sections into BomLineInput[]. */
  function collectBomLines(sections: BomSection[]): BomLineInput[] {
    const lines: BomLineInput[] = [];
    for (const section of sections) {
      const picked = pickerState[section.category] ?? [];
      for (const item of picked) {
        // Skip empty placeholder rows — only persist rows with an item.
        if (!item.item_id) continue;
        lines.push({
          category: section.category,
          variant: null,
          item_id: item.item_id,
          required_quantity: item.required_quantity || 0,
        });
      }
    }
    return lines;
  }

  /**
   * Ensure the job record exists AND its metadata matches the current form.
   * Returns the job ID. Calling this before any BOM save guarantees that
   * metadata changes (customer name, door type, capacity, …) are persisted
   * along with the BOM — the three save buttons share one source of truth.
   */
  async function ensureJob(): Promise<string> {
    if (!jobNumber.trim()) throw new Error("Job Number is required");
    if (savedJobId) {
      await updateJob(savedJobId, buildJobData());
      setJobSaved(true);
      return savedJobId;
    }
    const created = await createJob({ ...buildJobData(), created_by: readOperator() });
    setSavedJobId(created.id);
    setJobSaved(true);
    return created.id;
  }

  // ── Save handlers ─────────────────────────────────────────────────
  // Every save action enforces the same required-field check. If any
  // field is missing we surface an alert and bail before hitting the DB.
  function guardRequired(): boolean {
    if (isFormValid) return true;
    const problems = [...missingFields, ...(mobileError ? [mobileError] : [])];
    alert(
      `Please fix the following before saving:\n\n• ${problems.join("\n• ")}`,
    );
    return false;
  }

  function handleSaveJobDetails() {
    if (!guardRequired()) return;
    startTransition(async () => {
      try {
        if (savedJobId) {
          await updateJob(savedJobId, buildJobData());
        } else {
          const created = await createJob({ ...buildJobData(), created_by: readOperator() });
          setSavedJobId(created.id);
        }
        setJobSaved(true);
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      }
    });
  }

  function handleSavePhase(phase: string) {
    if (!guardRequired()) return;
    startTransition(async () => {
      setSavingPhase(phase); // spinner stays on the button the user clicked
      try {
        const jobId = await ensureJob();
        // Persist the WHOLE job's BOM (every visible phase), not just this
        // one — otherwise edits in other phases stay client-side only and
        // are silently lost on navigation.
        const categories = visibleSections.map((s) => s.category);
        const lines = collectBomLines(visibleSections);
        await saveBomSection(jobId, categories, lines);
        // Everything was persisted → reflect that on every phase button.
        const allSaved: Record<string, boolean> = {};
        for (const p of sectionsByPhase.keys()) allSaved[p] = true;
        setSavedPhases(allSaved);
        captureOutcome(jobId); // learning signal — never blocks the save
        // Refresh Router Cache so navigating to detail/edit shows fresh data
        router.refresh();
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      } finally {
        setSavingPhase(null);
      }
    });
  }

  function handleSaveAll() {
    if (!guardRequired()) return;
    startTransition(async () => {
      try {
        const jobId = await ensureJob();
        const categories = visibleSections.map((s) => s.category);
        const lines = collectBomLines(visibleSections);
        await saveBomSection(jobId, categories, lines);
        captureOutcome(jobId); // learning signal — never blocks the save
        // Invalidate client-side Router Cache so detail page shows fresh data
        router.refresh();
        router.push(`/jobs/${jobId}`);
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────
  // In split view the page becomes a 2-column grid:
  //   left:  the form (scrollable on its own)
  //   right: the GAD drawing panel (scrollable on its own)
  // Each column is bounded by a calc-height so each scrolls
  // independently rather than the whole page scrolling.
  const SPLIT_HEIGHT = "h-[calc(100vh-160px)]";
  return (
    <div className={splitView ? "flex flex-col" : "space-y-4 max-w-5xl mx-auto"}>
      {/* Header — compact. Centred when in single mode; full-width
          when in split mode so action buttons stay on screen. */}
      <div
        className={`flex items-center justify-between ${splitView ? "mb-3" : ""}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-md hover:bg-[var(--muted)] cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-bold truncate">
            {mode === "create" ? "New Job" : `Edit ${job?.job_number}`}
          </h1>
          {savedJobId && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${
                hasUnsavedChanges
                  ? "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]"
                  : "bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]"
              }`}
            >
              {hasUnsavedChanges ? "Unsaved" : "Saved"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[var(--muted-foreground)]">
            {totalPickedItems} item{totalPickedItems !== 1 ? "s" : ""}
          </span>
          {(mode === "create" || totalPickedItems === 0) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTemplateModalOpen(true)}
              disabled={isPending || importing}
              title="Copy spec + BOM from an existing job"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1.5" />
              )}
              Import from Job
            </Button>
          )}
          {savedJobId && (
            <Button
              size="sm"
              variant="secondary"
              onClick={runAutofill}
              disabled={isPending || autofilling}
              title="AI fills the spec (from the drawing) + the BOM (from your most similar past jobs) as a draft to review"
            >
              {autofilling ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              AI Auto-fill
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSplitView((v) => !v)}
            title={splitView ? "Hide drawing pane" : "Show drawing pane (split view)"}
          >
            {splitView ? (
              <PanelRightClose className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Columns2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            {splitView ? "Hide Drawing" : "Drawing"}
          </Button>
          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={isPending || !isFormValid}
          >
            {isPending && !savingPhase ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Save All &amp; Finish
          </Button>
        </div>
      </div>

      {templateModalOpen && (
        <JobTemplatePickerModal
          onPick={handlePickTemplate}
          onClose={() => setTemplateModalOpen(false)}
        />
      )}


      {/* In split view we render a 2-column grid: form on the left
          (scrollable), GAD drawing on the right (scrollable). In
          single view we fall back to the original stacked layout. */}
      <div
        className={
          splitView
            ? `grid grid-cols-2 gap-3 ${SPLIT_HEIGHT} min-h-0`
            : "contents"
        }
      >
        <div
          className={
            splitView
              ? "overflow-y-auto pr-2 space-y-4"
              : "contents"
          }
        >

      {/* ── Job Details ── */}
      <JobDetailsPanel
        mode={mode}
        savedJobId={savedJobId}
        isPending={isPending}
        savingPhase={savingPhase}
        jobSaved={jobSaved}
        isFormValid={isFormValid}
        jobNumber={jobNumber}
        customerName={customerName}
        mobileNumber={mobileNumber}
        mobileError={mobileError}
        location={location}
        stage={stage}
        requirementStage={requirementStage}
        requirementDispatchDate={requirementDispatchDate}
        setJobNumber={setJobNumber}
        setCustomerName={setCustomerName}
        setMobileNumber={setMobileNumber}
        setLocation={setLocation}
        setStage={setStage}
        setRequirementStage={setRequirementStage}
        setRequirementDispatchDate={setRequirementDispatchDate}
        setJobSaved={setJobSaved}
        onSaveDetails={handleSaveJobDetails}
      />

      {/* ── Elevator Spec ── */}
      <ElevatorSpecPanel
        floors={floors}
        driveType={driveType}
        capacity={capacity}
        structureIncluded={structureIncluded}
        setFloors={setFloors}
        setDriveType={setDriveType}
        setCapacity={setCapacity}
        setStructureIncluded={setStructureIncluded}
        onSpecChanged={markSpecChanged}
        specPreview={buildSpecString()}
      />

      {/* ── Missing-field banner ── */}
      {!isFormValid && (
        <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]">
          <span className="font-medium">Required to save:</span>{" "}
          {[...missingFields, ...(mobileError ? [mobileError] : [])].join(", ")}.
        </div>
      )}

      {/* ── AI Auto-fill context (drawing reads + manual-fill hints) ── */}
      {autofillPanelOpen && autofillResult && (
        <AutofillContextPanel
          result={autofillResult}
          onClose={() => setAutofillPanelOpen(false)}
        />
      )}

      {/* ── BOM Sections by Phase ── */}
      {Array.from(sectionsByPhase.entries()).map(([phase, sections]) => {
        const isSaving = savingPhase === phase;
        const isSaved = savedPhases[phase] === true;
        const phaseItemCount = sections.reduce(
          (n, s) =>
            n + (pickerState[s.category] ?? []).filter((r) => r.item_id).length,
          0,
        );

        return (
          <div
            key={phase}
            className="rounded-md border border-[var(--border)] bg-[var(--card)]"
          >
            {/* Phase header — sticky-ish, compact */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]/40">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
                  {phase}
                </h2>
                {phaseItemCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--background)] text-[var(--muted-foreground)] border border-[var(--border)]">
                    {phaseItemCount}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant={isSaved ? "secondary" : "primary"}
                onClick={() => handleSavePhase(phase)}
                disabled={isPending || !isFormValid}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : isSaved ? (
                  <Check className="h-3 w-3 mr-1 text-[var(--success)]" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                {isSaved ? "Saved" : "Save Phase"}
              </Button>
            </div>

            {/* Sections — single column, no inner cards, thin dividers */}
            <div className="px-4">
              {sections.map((section) => {
                const isAdHoc = phase === AD_HOC_PHASE;
                // Determine mapping status. Ad-hoc sections were picked
                // from the live tree so they always resolve. Hardcoded
                // sections rely on resolvedPaths (loaded async). Until
                // it loads, assume mapped to avoid a flash of warnings.
                const paths = section.defaultItemCategories ?? [];
                const isUnmapped =
                  !isAdHoc &&
                  resolvedPaths !== null &&
                  paths.length > 0 &&
                  !paths.some((p) => resolvedPaths.has(p));
                return (
                  <ItemPickerSection
                    key={section.category}
                    category={section.category}
                    description={section.description}
                    defaultItemCategories={section.defaultItemCategories}
                    items={pickerState[section.category] ?? []}
                    onItemsChange={(items) =>
                      setPickerItems(section.category, items)
                    }
                    onRemoveSection={
                      isAdHoc
                        ? () => removeAdHocSection(section.category)
                        : undefined
                    }
                    isUnmapped={isUnmapped}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* +Add Section — opens an inventory category picker so the user can
          add any sub-category as an ad-hoc section. */}
      <div className="flex justify-center">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPickerModalOpen(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Section From Inventory
        </Button>
      </div>

      {pickerModalOpen && (
        <CategoryPickerModal
          existingPaths={[
            ...BOM_SECTIONS.flatMap((s) => s.defaultItemCategories ?? []),
            ...adHocSections.map((s) => s.categoryPath),
          ]}
          onPick={addAdHocSection}
          onClose={() => setPickerModalOpen(false)}
        />
      )}

      {/* Bottom actions */}
      <div className="flex justify-end gap-2 pb-8 pt-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (savedJobId) {
              router.push(`/jobs/${savedJobId}`);
            } else {
              router.back();
            }
          }}
        >
          {savedJobId ? "Done" : "Cancel"}
        </Button>
        <Button
          size="sm"
          onClick={handleSaveAll}
          disabled={isPending || !isFormValid}
        >
          {isPending && !savingPhase ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1.5" />
          )}
          Save All &amp; Finish
        </Button>
      </div>

        </div>

        {/* Right pane: GAD drawing — only mounted in split view so the
            iframe doesn't load until the user actually opens it. */}
        {splitView && (
          <div className={SPLIT_HEIGHT}>
            <GadDrawingPanel
              jobId={savedJobId}
              initialUrl={job?.gad_drawing_url ?? null}
              initialFilename={job?.gad_drawing_filename ?? null}
              initialUploadedAt={job?.gad_drawing_uploaded_at ?? null}
              ensureJobId={async () => {
                if (!isFormValid) {
                  alert(
                    `Please fill required fields before uploading a drawing:\n\n• ${missingFields.join(
                      "\n• ",
                    )}`,
                  );
                  return null;
                }
                try {
                  return await ensureJob();
                } catch (err: unknown) {
                  alert(
                    `Could not save the job before upload: ${
                      err instanceof Error ? err.message : err
                    }`,
                  );
                  return null;
                }
              }}
              onClose={() => setSplitView(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
