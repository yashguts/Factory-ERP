"use client";

import { useState, useCallback, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ArrowLeft, Save, Loader2, Check } from "lucide-react";
import { BOM_SECTIONS, PHASE_ORDER } from "@/lib/bom/bom-sections";
import type { BomSection, BomLeaf } from "@/lib/bom/bom-sections";
import {
  shouldRenderSection,
  DOOR_TYPES,
  DRIVE_TYPES,
  STOPS_OPTIONS,
  CAPACITY_PASS,
  CAPACITY_KG,
} from "@/lib/bom/section-gating";
import { CarLandingDoorsEditor } from "@/components/jobs/car-landing-doors-editor";
import { MainBracketEditor } from "@/components/jobs/main-bracket-editor";
import { CounterBracketEditor } from "@/components/jobs/counter-bracket-editor";
import { SafetyEditor } from "@/components/jobs/safety-editor";
import { MachineEditor } from "@/components/jobs/machine-editor";
import { GovernorEditor } from "@/components/jobs/governor-editor";
import { FillerWeightEditor } from "@/components/jobs/filler-weight-editor";
import { CabinItemsEditor } from "@/components/jobs/cabin-items-editor";
import {
  createJob,
  updateJob,
  saveBomSection,
  createJobWithBom,
  updateJobWithBom,
} from "@/lib/actions/jobs";
import type { BomLineInput } from "@/lib/actions/jobs";
import type { Job, JobStage } from "@/lib/supabase/types";

const STAGE_OPTIONS: { value: JobStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "first_phase", label: "First Phase" },
  { value: "full_material", label: "Full Material" },
];

interface BomValue {
  numVal?: number;
  textVal?: string;
}

type BomState = Record<string, BomValue>;

function bomKey(category: string, variant: string) {
  return `${category}::${variant}`;
}

interface Props {
  mode: "create" | "edit";
  job?: Job;
  existingBom?: Array<{
    category: string;
    variant: string;
    value_text: string | null;
    required_quantity: number;
  }>;
}

export function JobForm({ mode, job, existingBom }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Track saved job ID — in create mode starts null, gets set on first save
  const [savedJobId, setSavedJobId] = useState<string | null>(job?.id ?? null);
  // Track which phases have been saved (for visual feedback)
  const [savedPhases, setSavedPhases] = useState<Record<string, boolean>>({});
  const [savingPhase, setSavingPhase] = useState<string | null>(null);
  const [jobSaved, setJobSaved] = useState(mode === "edit");

  const [jobNumber, setJobNumber] = useState(job?.job_number ?? "");
  const [customerName, setCustomerName] = useState(job?.customer_name ?? "");
  const [location, setLocation] = useState(job?.location ?? "");
  const [doorFinish, setDoorFinish] = useState(job?.door_finish ?? "");
  const [brand, setBrand] = useState(job?.brand ?? "");
  const [remark, setRemark] = useState(job?.remark ?? "");
  const [orderDate, setOrderDate] = useState(job?.order_date ?? "");
  const [expectedDelivery, setExpectedDelivery] = useState(
    job?.expected_delivery ?? "",
  );

  const [stage, setStage] = useState<JobStage>(job?.stage ?? "new");
  const [requirementStage, setRequirementStage] = useState<JobStage | "">(job?.requirement_stage ?? "");
  const [requirementDispatchDate, setRequirementDispatchDate] = useState(job?.requirement_dispatch_date ?? "");

  const [floors, setFloors] = useState<number | "">(job?.floors ?? "");
  const [doorType, setDoorType] = useState(job?.door_type ?? "");
  const [driveType, setDriveType] = useState(job?.drive_type ?? "");
  const [capacity, setCapacity] = useState(job?.capacity ?? "");

  const initialBom = useMemo(() => {
    const state: BomState = {};
    if (existingBom) {
      for (const line of existingBom) {
        const key = bomKey(line.category, line.variant);
        state[key] = {
          numVal: line.required_quantity || undefined,
          textVal: line.value_text ?? undefined,
        };
      }
    }
    return state;
  }, [existingBom]);

  const [bomState, setBomState] = useState<BomState>(initialBom);

  const setBomValue = useCallback(
    (category: string, variant: string, val: BomValue) => {
      setBomState((prev) => ({
        ...prev,
        [bomKey(category, variant)]: val,
      }));
    },
    [],
  );

  const getBomValue = useCallback(
    (category: string, variant: string): BomValue => {
      return bomState[bomKey(category, variant)] ?? {};
    },
    [bomState],
  );

  const visibleSections = useMemo(() => {
    return BOM_SECTIONS.filter((s) =>
      shouldRenderSection(s, doorType || null, driveType || null),
    );
  }, [doorType, driveType]);

  const sectionsByPhase = useMemo(() => {
    const map = new Map<string, BomSection[]>();
    for (const phase of PHASE_ORDER) {
      const sections = visibleSections.filter((s) => s.phase === phase);
      if (sections.length > 0) map.set(phase, sections);
    }
    return map;
  }, [visibleSections]);

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

  /** Collect BOM lines for specific sections only */
  function collectBomLinesForSections(sections: BomSection[]): BomLineInput[] {
    const lines: BomLineInput[] = [];
    for (const section of sections) {
      for (const leaf of section.leaves) {
        const val = getBomValue(section.category, leaf.variant);
        if (
          (val.numVal != null && val.numVal !== 0) ||
          (val.textVal != null && val.textVal !== "")
        ) {
          lines.push({
            category: section.category,
            variant: leaf.variant,
            value_text: leaf.kind !== "number" ? (val.textVal ?? null) : null,
            required_quantity:
              leaf.kind === "number" ? (val.numVal ?? 0) : 0,
          });
        }
      }
    }
    return lines;
  }

  /** Ensure the job exists (create if needed), return job ID */
  async function ensureJob(): Promise<string> {
    if (savedJobId) return savedJobId;
    if (!jobNumber.trim()) throw new Error("Job Number is required");
    const created = await createJob(buildJobData());
    setSavedJobId(created.id);
    setJobSaved(true);
    return created.id;
  }

  /** Save Job Details (metadata + spec) */
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

  /** Save a specific BOM phase */
  function handleSavePhase(phase: string, sections: BomSection[]) {
    startTransition(async () => {
      setSavingPhase(phase);
      try {
        const jobId = await ensureJob();
        const categories = sections.map((s) => s.category);
        const lines = collectBomLinesForSections(sections);
        await saveBomSection(jobId, categories, lines);
        setSavedPhases((prev) => ({ ...prev, [phase]: true }));
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      } finally {
        setSavingPhase(null);
      }
    });
  }

  /** Save everything at once (legacy full save) */
  function handleSaveAll() {
    if (!jobNumber.trim()) return;
    startTransition(async () => {
      const allLines = collectBomLinesForSections(visibleSections);
      const jobData = buildJobData();
      try {
        if (mode === "create" && !savedJobId) {
          const created = await createJobWithBom(jobData, allLines);
          router.push(`/jobs/${created.id}`);
        } else {
          const id = savedJobId ?? job?.id;
          if (id) {
            await updateJobWithBom(id, jobData, allLines);
            router.push(`/jobs/${id}`);
          }
        }
      } catch (err: any) {
        alert(`Error: ${err.message ?? err}`);
      }
    });
  }

  const filledCount = useMemo(() => {
    let count = 0;
    for (const section of visibleSections) {
      for (const leaf of section.leaves) {
        const val = getBomValue(section.category, leaf.variant);
        if (
          (val.numVal != null && val.numVal !== 0) ||
          (val.textVal != null && val.textVal !== "")
        )
          count++;
      }
    }
    return count;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomState, visibleSections]);

  const totalLeaves = useMemo(
    () => visibleSections.reduce((s, sec) => s + sec.leaves.length, 0),
    [visibleSections],
  );

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
            {filledCount}/{totalLeaves} BOM fields
          </span>
          <Button onClick={handleSaveAll} disabled={isPending || !jobNumber.trim()}>
            {isPending && !savingPhase ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save All & Finish
          </Button>
        </div>
      </div>

      {/* Job Metadata */}
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
              onChange={(e) => { setJobNumber(e.target.value); setJobSaved(false); }}
              placeholder="e.g. 1234 or LT-001"
              disabled={mode === "edit" || !!savedJobId}
            />
          </Field>
          <Field label="Customer Name">
            <Input
              value={customerName}
              onChange={(e) => { setCustomerName(e.target.value); setJobSaved(false); }}
              placeholder="Customer"
            />
          </Field>
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => { setLocation(e.target.value); setJobSaved(false); }}
              placeholder="Site location"
            />
          </Field>
          <Field label="Door Finish">
            <Input
              value={doorFinish}
              onChange={(e) => { setDoorFinish(e.target.value); setJobSaved(false); }}
              placeholder="e.g. SS Hairline"
            />
          </Field>
          <Field label="Brand">
            <Select
              value={brand}
              onChange={(e) => { setBrand(e.target.value); setJobSaved(false); }}
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
              onChange={(e) => { setOrderDate(e.target.value); setJobSaved(false); }}
            />
          </Field>
          <Field label="Expected Delivery">
            <Input
              type="date"
              value={expectedDelivery}
              onChange={(e) => { setExpectedDelivery(e.target.value); setJobSaved(false); }}
            />
          </Field>
          <Field label="Remark">
            <Input
              value={remark}
              onChange={(e) => { setRemark(e.target.value); setJobSaved(false); }}
              placeholder="Notes"
            />
          </Field>
          <Field label="Stage">
            <Select value={stage} onChange={(e) => { setStage(e.target.value as JobStage); setJobSaved(false); }}>
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Requirement Stage">
            <Select value={requirementStage} onChange={(e) => { setRequirementStage(e.target.value as JobStage | ""); setJobSaved(false); }}>
              <option value="">—</option>
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Req. Dispatch Date">
            <Input
              type="date"
              value={requirementDispatchDate}
              onChange={(e) => { setRequirementDispatchDate(e.target.value); setJobSaved(false); }}
            />
          </Field>
        </div>
      </div>

      {/* Elevator Spec */}
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
              onChange={(e) => { setDoorType(e.target.value); setJobSaved(false); }}
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
              onChange={(e) => { setDriveType(e.target.value); setJobSaved(false); }}
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
              onChange={(e) => { setCapacity(e.target.value); setJobSaved(false); }}
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

      {/* BOM Sections by Phase */}
      {Array.from(sectionsByPhase.entries()).map(([phase, sections]) => {
        const isSaving = savingPhase === phase;
        const isSaved = savedPhases[phase] === true;

        return (
          <div key={phase}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {phase}
              </h2>
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
              {sections.map((section) =>
                section.customEditor === "car-landing-doors" ? (
                  <CarLandingDoorsEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "main-bracket" ? (
                  <MainBracketEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "counter-bracket" ? (
                  <CounterBracketEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "safety" ? (
                  <SafetyEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "machine" ? (
                  <MachineEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "governor" ? (
                  <GovernorEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "filler-weight" ? (
                  <FillerWeightEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : section.customEditor === "cabin-items" ? (
                  <CabinItemsEditor
                    key={section.category}
                    category={section.category}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ) : (
                  <SectionCard
                    key={section.category}
                    section={section}
                    getBomValue={getBomValue}
                    setBomValue={setBomValue}
                  />
                ),
              )}
            </div>
          </div>
        );
      })}

      {/* Bottom save */}
      <div className="flex justify-end gap-3 pb-8">
        <Button variant="secondary" onClick={() => {
          if (savedJobId) {
            router.push(`/jobs/${savedJobId}`);
          } else {
            router.back();
          }
        }}>
          {savedJobId ? "Done" : "Cancel"}
        </Button>
        <Button onClick={handleSaveAll} disabled={isPending || !jobNumber.trim()}>
          {isPending && !savingPhase ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save All & Finish
        </Button>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  getBomValue,
  setBomValue,
}: {
  section: BomSection;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}) {
  const filledLeaves = section.leaves.filter((l) => {
    const v = getBomValue(section.category, l.variant);
    return (v.numVal != null && v.numVal !== 0) || (v.textVal && v.textVal !== "");
  }).length;

  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 ${
        section.fullWidth ? "lg:col-span-2" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">
          {section.category}
        </h3>
        {filledLeaves > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {filledLeaves}/{section.leaves.length}
          </span>
        )}
      </div>
      {section.description && (
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          {section.description}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {section.leaves.map((leaf) => (
          <LeafInput
            key={leaf.variant}
            leaf={leaf}
            category={section.category}
            value={getBomValue(section.category, leaf.variant)}
            onChange={(val) =>
              setBomValue(section.category, leaf.variant, val)
            }
          />
        ))}
      </div>
    </div>
  );
}

function LeafInput({
  leaf,
  category,
  value,
  onChange,
}: {
  leaf: BomLeaf;
  category: string;
  value: BomValue;
  onChange: (val: BomValue) => void;
}) {
  if (leaf.kind === "number") {
    return (
      <div>
        <label className="block text-xs text-[var(--muted-foreground)] mb-1 truncate" title={leaf.variant}>
          {leaf.variant}
          {leaf.unit && (
            <span className="text-[10px] ml-1 opacity-60">({leaf.unit})</span>
          )}
        </label>
        <Input
          type="number"
          min={0}
          step="any"
          className="h-8 text-sm"
          value={value.numVal ?? ""}
          onChange={(e) =>
            onChange({
              numVal: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </div>
    );
  }

  if (leaf.kind === "select" && leaf.options) {
    return (
      <div>
        <label className="block text-xs text-[var(--muted-foreground)] mb-1 truncate" title={leaf.variant}>
          {leaf.variant}
        </label>
        <Select
          className="h-8 text-sm"
          value={value.textVal ?? ""}
          onChange={(e) => onChange({ textVal: e.target.value || undefined })}
        >
          <option value="">--</option>
          {leaf.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs text-[var(--muted-foreground)] mb-1 truncate" title={leaf.variant}>
        {leaf.variant}
        {leaf.unit && (
          <span className="text-[10px] ml-1 opacity-60">({leaf.unit})</span>
        )}
      </label>
      <Input
        type="text"
        className="h-8 text-sm"
        value={value.textVal ?? ""}
        onChange={(e) => onChange({ textVal: e.target.value || undefined })}
      />
    </div>
  );
}

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
