"use client";

import { useState, useCallback, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ArrowLeft, Save, Loader2, Check, Plus } from "lucide-react";
import { BOM_SECTIONS, PHASE_ORDER } from "@/lib/bom/bom-sections";
import type { BomSection } from "@/lib/bom/bom-sections";
import {
  shouldRenderSection,
  DOOR_TYPES,
  DRIVE_TYPES,
  STOPS_OPTIONS,
  CAPACITY_PASS,
  CAPACITY_KG,
} from "@/lib/bom/section-gating";
import { ItemPickerSection } from "@/components/jobs/item-picker-section";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import { CategoryPickerModal } from "@/components/jobs/category-picker-modal";
import {
  createJob,
  updateJob,
  saveBomSection,
} from "@/lib/actions/jobs";
import type { BomLineInput } from "@/lib/actions/jobs";
import { checkCategoryPaths } from "@/lib/actions/categories";
import type { Job, JobStage } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

const STAGE_OPTIONS: { value: JobStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "first_phase", label: "First Phase" },
  { value: "full_material", label: "Full Material" },
];

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
  const [jobNumber, setJobNumber] = useState(job?.job_number ?? "");
  const [customerName, setCustomerName] = useState(
    job?.customer_name ?? "",
  );
  const [location, setLocation] = useState(job?.location ?? "");
  const [doorFinish, setDoorFinish] = useState(job?.door_finish ?? "");
  const [brand, setBrand] = useState(job?.brand ?? "");
  const [remark, setRemark] = useState(job?.remark ?? "");
  const [orderDate, setOrderDate] = useState(job?.order_date ?? "");
  const [expectedDelivery, setExpectedDelivery] = useState(
    job?.expected_delivery ?? "",
  );
  const [stage, setStage] = useState<JobStage>(job?.stage ?? "new");
  const [requirementStage, setRequirementStage] = useState<JobStage | "">(
    job?.requirement_stage ?? "",
  );
  const [requirementDispatchDate, setRequirementDispatchDate] = useState(
    job?.requirement_dispatch_date ?? "",
  );

  // ── Elevator spec (controls which BOM sections are visible) ──────
  const [floors, setFloors] = useState<number | "">(job?.floors ?? "");
  const [doorType, setDoorType] = useState(job?.door_type ?? "");
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
    const hardcoded = BOM_SECTIONS.filter((s) =>
      shouldRenderSection(s, doorType || null, driveType || null),
    );
    const adHoc: BomSection[] = adHocSections.map((s) => ({
      category: s.category,
      phase: AD_HOC_PHASE,
      gate: { kind: "always" },
      defaultItemCategories: [s.categoryPath],
    }));
    return [...hardcoded, ...adHoc];
  }, [doorType, driveType, adHocSections]);

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
    if (doorType) parts.push(doorType);
    if (driveType) parts.push(driveType);
    if (capacity) parts.push(capacity);
    return parts.join("/") || null;
  }

  function buildJobData() {
    // Use null (not undefined) for cleared fields so Supabase actually
    // overwrites the column. undefined would be silently dropped from the
    // update payload, leaving stale DB values.
    return {
      job_number: jobNumber.trim(),
      customer_name: customerName || null,
      spec_string: buildSpecString(),
      door_finish: doorFinish || null,
      location: location || null,
      brand: brand || null,
      floors: floors || null,
      door_type: doorType || null,
      drive_type: driveType || null,
      capacity: capacity || null,
      remark: remark || null,
      order_date: orderDate || null,
      expected_delivery: expectedDelivery || null,
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
  function handleSaveJobDetails() {
    if (!jobNumber.trim()) return;
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
    if (!jobNumber.trim()) return;
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
          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={isPending || !jobNumber.trim()}
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

      {/* ── Job Details ── */}
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Job Details
          </h2>
          <Button
            size="sm"
            variant={jobSaved ? "secondary" : "primary"}
            onClick={handleSaveJobDetails}
            disabled={isPending || !jobNumber.trim()}
          >
            {isPending && !savingPhase ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : jobSaved ? (
              <Check className="h-3 w-3 mr-1 text-green-600" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            {jobSaved ? "Saved" : "Save Details"}
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <Field label="Job Number *">
            <Input
              value={jobNumber}
              onChange={(e) => {
                setJobNumber(e.target.value);
                setJobSaved(false);
              }}
              placeholder="e.g. 1234 or LT-001"
              disabled={mode === "edit" || !!savedJobId}
            />
          </Field>
          <Field label="Customer Name">
            <Input
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                setJobSaved(false);
              }}
              placeholder="Customer"
            />
          </Field>
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setJobSaved(false);
              }}
              placeholder="Site location"
            />
          </Field>
          <Field label="Door Finish">
            <Input
              value={doorFinish}
              onChange={(e) => {
                setDoorFinish(e.target.value);
                setJobSaved(false);
              }}
              placeholder="e.g. SS Hairline"
            />
          </Field>
          <Field label="Brand">
            <Select
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setJobSaved(false);
              }}
            >
              <option value="">Select brand</option>
              <option value="Ricardo">Ricardo</option>
              <option value="LT">LT</option>
            </Select>
          </Field>
          <Field label="Order Date">
            <Input
              type="date"
              value={orderDate}
              onChange={(e) => {
                setOrderDate(e.target.value);
                setJobSaved(false);
              }}
            />
          </Field>
          <Field label="Expected Delivery">
            <Input
              type="date"
              value={expectedDelivery}
              onChange={(e) => {
                setExpectedDelivery(e.target.value);
                setJobSaved(false);
              }}
            />
          </Field>
          <Field label="Remark">
            <Input
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                setJobSaved(false);
              }}
              placeholder="Notes"
            />
          </Field>
          <Field label="Stage">
            <Select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value as JobStage);
                setJobSaved(false);
              }}
            >
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Requirement Stage">
            <Select
              value={requirementStage}
              onChange={(e) => {
                setRequirementStage(e.target.value as JobStage | "");
                setJobSaved(false);
              }}
            >
              <option value="">---</option>
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Req. Dispatch Date">
            <Input
              type="date"
              value={requirementDispatchDate}
              onChange={(e) => {
                setRequirementDispatchDate(e.target.value);
                setJobSaved(false);
              }}
            />
          </Field>
        </div>
      </div>

      {/* ── Elevator Spec ── */}
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Elevator Specification
          </h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Controls which BOM sections appear below.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Floors (Stops)">
            <Select
              value={floors}
              onChange={(e) => {
                setFloors(e.target.value ? Number(e.target.value) : "");
                markSpecChanged();
              }}
            >
              <option value="">Select</option>
              {STOPS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  G+{n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Door Type">
            <Select
              value={doorType}
              onChange={(e) => {
                setDoorType(e.target.value);
                markSpecChanged();
              }}
            >
              <option value="">Select</option>
              {DOOR_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Drive Type">
            <Select
              value={driveType}
              onChange={(e) => {
                setDriveType(e.target.value);
                markSpecChanged();
              }}
            >
              <option value="">Select</option>
              {DRIVE_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Capacity">
            <Select
              value={capacity}
              onChange={(e) => {
                setCapacity(e.target.value);
                markSpecChanged();
              }}
            >
              <option value="">Select</option>
              <optgroup label="Passengers">
                {CAPACITY_PASS.map((n) => (
                  <option key={`p${n}`} value={`${n}PASS`}>
                    {n} Passengers
                  </option>
                ))}
              </optgroup>
              <optgroup label="Kilograms">
                {CAPACITY_KG.map((n) => (
                  <option key={`k${n}`} value={`${n}KG`}>
                    {n} kg
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
        </div>
        {buildSpecString() && (
          <p className="mt-2 text-[11px] font-mono text-[var(--muted-foreground)]">
            Spec: {buildSpecString()}
          </p>
        )}
      </div>

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
                disabled={isPending || !jobNumber.trim()}
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
          disabled={isPending || !jobNumber.trim()}
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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="[&_input]:h-8 [&_input]:text-sm [&_select]:h-8 [&_select]:text-sm [&_select]:py-1">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
