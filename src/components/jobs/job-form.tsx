"use client";

import { useState, useCallback, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ArrowLeft, Save, Loader2, Check } from "lucide-react";
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
import {
  createJob,
  updateJob,
  saveBomSection,
} from "@/lib/actions/jobs";
import type { BomLineInput } from "@/lib/actions/jobs";
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
  const [savedPhases, setSavedPhases] = useState<Record<string, boolean>>({});
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

  const setPickerItems = useCallback(
    (category: string, items: PickedItem[]) => {
      setPickerState((prev) => ({ ...prev, [category]: items }));
    },
    [],
  );

  // ── Visible sections & grouping ──────────────────────────────────
  const visibleSections = useMemo(
    () =>
      BOM_SECTIONS.filter((s) =>
        shouldRenderSection(s, doorType || null, driveType || null),
      ),
    [doorType, driveType],
  );

  const sectionsByPhase = useMemo(() => {
    const map = new Map<string, BomSection[]>();
    for (const phase of PHASE_ORDER) {
      const secs = visibleSections.filter((s) => s.phase === phase);
      if (secs.length > 0) map.set(phase, secs);
    }
    return map;
  }, [visibleSections]);

  // ── Counts ────────────────────────────────────────────────────────
  const totalPickedItems = useMemo(() => {
    let n = 0;
    for (const section of visibleSections) {
      n += (pickerState[section.category] ?? []).length;
    }
    return n;
  }, [pickerState, visibleSections]);

  // ── Helpers ───────────────────────────────────────────────────────
  function buildSpecString() {
    const parts = [];
    if (floors) parts.push(`G+${floors}`);
    if (doorType) parts.push(doorType);
    if (driveType) parts.push(driveType);
    if (capacity) parts.push(capacity);
    return parts.join("/") || undefined;
  }

  function buildJobData() {
    return {
      job_number: jobNumber.trim(),
      customer_name: customerName || undefined,
      spec_string: buildSpecString(),
      door_finish: doorFinish || undefined,
      location: location || undefined,
      brand: brand || undefined,
      floors: floors || undefined,
      door_type: doorType || undefined,
      drive_type: driveType || undefined,
      capacity: capacity || undefined,
      remark: remark || undefined,
      order_date: orderDate || undefined,
      expected_delivery: expectedDelivery || undefined,
      stage,
      requirement_stage: requirementStage || undefined,
      requirement_dispatch_date: requirementDispatchDate || undefined,
    };
  }

  /** Convert picker state for given sections into BomLineInput[]. */
  function collectBomLines(sections: BomSection[]): BomLineInput[] {
    const lines: BomLineInput[] = [];
    for (const section of sections) {
      const picked = pickerState[section.category] ?? [];
      for (const item of picked) {
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

  /** Ensure the job record exists; returns its ID. */
  async function ensureJob(): Promise<string> {
    if (savedJobId) return savedJobId;
    if (!jobNumber.trim()) throw new Error("Job Number is required");
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
        router.push(`/jobs/${jobId}`);
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-md hover:bg-[var(--muted)]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">
            {mode === "create" ? "New Job" : `Edit ${job?.job_number}`}
          </h1>
          {savedJobId && mode === "create" && (
            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
              Job Created
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--muted-foreground)]">
            {totalPickedItems} BOM item{totalPickedItems !== 1 ? "s" : ""}
          </span>
          <Button
            onClick={handleSaveAll}
            disabled={isPending || !jobNumber.trim()}
          >
            {isPending && !savingPhase ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save All &amp; Finish
          </Button>
        </div>
      </div>

      {/* ── Job Details ── */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Job Details</h2>
          <Button
            size="sm"
            variant={jobSaved ? "secondary" : "primary"}
            onClick={handleSaveJobDetails}
            disabled={isPending || !jobNumber.trim()}
          >
            {isPending && !savingPhase ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : jobSaved ? (
              <Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            {jobSaved ? "Saved" : "Save Job"}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-lg font-semibold mb-4">Elevator Specification</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Changing these values controls which BOM sections appear below.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Floors (Stops)">
            <Select
              value={floors}
              onChange={(e) => {
                setFloors(e.target.value ? Number(e.target.value) : "");
                setJobSaved(false);
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
                setJobSaved(false);
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
                setJobSaved(false);
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
                setJobSaved(false);
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
          <p className="mt-3 text-sm font-mono text-[var(--muted-foreground)]">
            Spec: {buildSpecString()}
          </p>
        )}
      </div>

      {/* ── BOM Sections by Phase ── */}
      {Array.from(sectionsByPhase.entries()).map(([phase, sections]) => {
        const isSaving = savingPhase === phase;
        const isSaved = savedPhases[phase] === true;
        const phaseItemCount = sections.reduce(
          (n, s) => n + (pickerState[s.category] ?? []).length,
          0,
        );

        return (
          <div key={phase}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  {phase}
                </h2>
                {phaseItemCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
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
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : isSaved ? (
                  <Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                {isSaved ? "Saved" : "Save Section"}
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sections.map((section) => (
                <div
                  key={section.category}
                  className={section.fullWidth ? "lg:col-span-2" : ""}
                >
                  <ItemPickerSection
                    category={section.category}
                    description={section.description}
                    defaultItemCategories={section.defaultItemCategories}
                    items={pickerState[section.category] ?? []}
                    onItemsChange={(items) =>
                      setPickerItems(section.category, items)
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Bottom actions */}
      <div className="flex justify-end gap-3 pb-8">
        <Button
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
          onClick={handleSaveAll}
          disabled={isPending || !jobNumber.trim()}
        >
          {isPending && !savingPhase ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
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
    <div>
      <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
