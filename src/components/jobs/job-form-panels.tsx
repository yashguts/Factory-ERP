"use client";

import { Loader2, Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DRIVE_TYPES,
  STOPS_OPTIONS,
  CAPACITY_PASS,
  CAPACITY_KG,
} from "@/lib/bom/section-gating";
import type { JobStage } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ */
/*  Shared types                                                      */
/* ------------------------------------------------------------------ */

export const STAGE_OPTIONS: { value: JobStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "first_phase", label: "First Phase" },
  { value: "full_material", label: "Full Material" },
];

/* ------------------------------------------------------------------ */
/*  Field helper                                                      */
/* ------------------------------------------------------------------ */

export function Field({
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

/* ================================================================== */
/*  JobDetailsPanel                                                   */
/* ================================================================== */

interface JobDetailsPanelProps {
  mode: "create" | "edit";
  savedJobId: string | null;
  isPending: boolean;
  savingPhase: string | null;
  jobSaved: boolean;
  isFormValid: boolean;

  jobNumber: string;
  customerName: string;
  location: string;
  stage: JobStage;
  requirementStage: JobStage | "";
  requirementDispatchDate: string;

  setJobNumber: (v: string) => void;
  setCustomerName: (v: string) => void;
  setLocation: (v: string) => void;
  setStage: (v: JobStage) => void;
  setRequirementStage: (v: JobStage | "") => void;
  setRequirementDispatchDate: (v: string) => void;

  setJobSaved: (v: boolean) => void;
  onSaveDetails: () => void;
}

export function JobDetailsPanel({
  mode,
  savedJobId,
  isPending,
  savingPhase,
  jobSaved,
  isFormValid,
  jobNumber,
  customerName,
  location,
  stage,
  requirementStage,
  requirementDispatchDate,
  setJobNumber,
  setCustomerName,
  setLocation,
  setStage,
  setRequirementStage,
  setRequirementDispatchDate,
  setJobSaved,
  onSaveDetails,
}: JobDetailsPanelProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Job Details
        </h2>
        <Button
          size="sm"
          variant={jobSaved ? "secondary" : "primary"}
          onClick={onSaveDetails}
          disabled={isPending || !isFormValid}
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
        <Field label="Customer Name *">
          <Input
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              setJobSaved(false);
            }}
            placeholder="Customer"
          />
        </Field>
        <Field label="Location *">
          <Input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setJobSaved(false);
            }}
            placeholder="Site location"
          />
        </Field>
        <Field label="Stage *">
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
        <Field label="Requirement Stage *">
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
        <Field label="Req. Dispatch Date *">
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
  );
}

/* ================================================================== */
/*  ElevatorSpecPanel                                                 */
/* ================================================================== */

interface ElevatorSpecPanelProps {
  floors: number | "";
  driveType: string;
  capacity: string;
  setFloors: (v: number | "") => void;
  setDriveType: (v: string) => void;
  setCapacity: (v: string) => void;
  onSpecChanged: () => void;
  specPreview: string | null;
}

export function ElevatorSpecPanel({
  floors,
  driveType,
  capacity,
  setFloors,
  setDriveType,
  setCapacity,
  onSpecChanged,
  specPreview,
}: ElevatorSpecPanelProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Elevator Specification
        </h2>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Controls which BOM sections appear below.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Floors (Stops) *">
          <Select
            value={floors}
            onChange={(e) => {
              setFloors(e.target.value ? Number(e.target.value) : "");
              onSpecChanged();
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
        <Field label="Drive Type *">
          <Select
            value={driveType}
            onChange={(e) => {
              setDriveType(e.target.value);
              onSpecChanged();
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
        <Field label="Capacity *">
          <Select
            value={capacity}
            onChange={(e) => {
              setCapacity(e.target.value);
              onSpecChanged();
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
      {specPreview && (
        <p className="mt-2 text-[11px] font-mono text-[var(--muted-foreground)]">
          Spec: {specPreview}
        </p>
      )}
    </div>
  );
}
