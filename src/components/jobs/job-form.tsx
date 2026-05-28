"use client";

import { useState, useCallback, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Loader2, Plus, Check, Copy } from "lucide-react";
import { BOM_SECTIONS, PHASE_ORDER } from "@/lib/bom/bom-sections";
import type { BomSection } from "@/lib/bom/bom-sections";
import { shouldRenderSection } from "@/lib/bom/section-gating";
import { ItemPickerSection } from "@/components/jobs/item-picker-section";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import { CategoryPickerModal } from "@/components/jobs/category-picker-modal";
import { JobTemplatePickerModal } from "@/components/jobs/job-template-picker-modal";
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
import { checkCategoryPaths } from "@/lib/actions/categories";
import type { Job, JobStage } from "@/lib/supabase/types";

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
  const [location, setLocation] = useState(job?.location ?? "");
  const [stage, setStage] = useState<JobStage>(job?.stage ?? "new");
  const [requirementStage, setRequirementStage] = useState<JobStage | "">(
    job?.requirement_stage ?? "",
  );
  const [requirementDispatchDate, setRequirementDispatchDate] = useState(
    job?.requirement_dispatch_date ?? "",
  );

  // ── Elevator spec (controls which BOM sections are visible) ──────
  const [floors, setFloors] = useState<number | "">(job?.floors ?? "");
  const [driveType, setDriveType] = useState(job?.drive_type ?? "");
  const [capacity, setCapacity] = useState(job?.capacity ?? "");

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
    if (!requirementStage) missing.push("Requirement Stage");
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
    requirementStage,
    requirementDispatchDate,
    floors,
    driveType,
    capacity,
  ]);
  const isFormValid = missingFields.length === 0;

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
    if (floors) parts.push(`G+${floors}`);
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
      location: location.trim() || null,
      spec_string: buildSpecString(),
      floors: floors || null,
      drive_type: driveType || null,
      capacity: capacity || null,
      stage,
      requirement_stage: requirementStage || null,
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
    const created = await createJob(buildJobData());
    setSavedJobId(created.id);
    setJobSaved(true);
    return created.id;
  }

  // ── Save handlers ─────────────────────────────────────────────────
  // Every save action enforces the same required-field check. If any
  // field is missing we surface an alert and bail before hitting the DB.
  function guardRequired(): boolean {
    if (isFormValid) return true;
    alert(
      `Please fill the following required field${
        missingFields.length === 1 ? "" : "s"
      } before saving:\n\n• ${missingFields.join("\n• ")}`,
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
          const created = await createJob(buildJobData());
          setSavedJobId(created.id);
        }
        setJobSaved(true);
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      }
    });
  }

  function handleSavePhase(phase: string, sections: BomSection[]) {
    if (!guardRequired()) return;
    startTransition(async () => {
      setSavingPhase(phase);
      try {
        const jobId = await ensureJob();
        const categories = sections.map((s) => s.category);
        const lines = collectBomLines(sections);
        await saveBomSection(jobId, categories, lines);
        setSavedPhases((prev) => ({ ...prev, [phase]: true }));
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
        // Invalidate client-side Router Cache so detail page shows fresh data
        router.refresh();
        router.push(`/jobs/${jobId}`);
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header — compact */}
      <div className="flex items-center justify-between">
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
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                hasUnsavedChanges
                  ? "bg-amber-100 text-amber-800"
                  : "bg-green-100 text-green-700"
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
          {mode === "create" && (
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
        location={location}
        stage={stage}
        requirementStage={requirementStage}
        requirementDispatchDate={requirementDispatchDate}
        setJobNumber={setJobNumber}
        setCustomerName={setCustomerName}
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
        setFloors={setFloors}
        setDriveType={setDriveType}
        setCapacity={setCapacity}
        onSpecChanged={markSpecChanged}
        specPreview={buildSpecString()}
      />

      {/* ── Missing-field banner ── */}
      {!isFormValid && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">Required to save:</span>{" "}
          {missingFields.join(", ")}.
        </div>
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
                onClick={() => handleSavePhase(phase, sections)}
                disabled={isPending || !isFormValid}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : isSaved ? (
                  <Check className="h-3 w-3 mr-1 text-green-600" />
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
  );
}
