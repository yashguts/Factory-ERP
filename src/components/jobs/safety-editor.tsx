"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const SAFETY_TYPE_OPTIONS = [
  "Goods", "Home", "MRL", "R1", "R1/150", "Standard", "Belt", "Cantilever", "Hydraulic",
] as const;

const PULLEY_SPEC_OPTIONS = [
  "200/4G/6", "300/4G/8", "300/5G/8", "300/6G/8", "300/7G/8", "300/8G/8",
  "320/6G/8", "400/10G/8", "400/6G/8", "400/7G/8", "400/8G/10", "400/8G/8",
  "500/4G/13", "500/3G/13", "200/3G/13", "400/5G/8", "500/6G/8",
  "200/4G/6/PVC", "300/4G/8/PVC", "300/6G/8/PVC", "300/7G/8/PVC",
  "400/4G/8", "400/3G/13",
] as const;

const COUNTER_FRAME_ROPE_BELT_OPTIONS = ["Rope", "Belt"] as const;

const COUNTER_FRAME_TYPE_OPTIONS = [
  "550 (Home)", "650 (Home)", "750 (Home)", "850 (Home)",
  "710 S", "850 S", "1050 S",
  "710 M", "850 M", "1050 M",
  "1050 G", "1350 G", "1750 G", "1550 G", "2450 G",
] as const;

const COUNTER_GUARD_NET_TYPE_OPTIONS = [
  "550 (Home)", "650 (Home)", "750 (Home)", "850 (Home)",
  "710 S", "850 S (50)", "850 S (65)", "1050 S", "1050 S (50)", "1050 S (65)",
  "1050 G", "1350 G", "1750 G", "1550 G", "2450 G",
] as const;

const MB_HOME_OPTIONS = [
  "550R", "650R", "750R", "850R", "550B", "650B", "750B", "850B",
] as const;

const MB_2_1_OPTIONS = [
  "620R1", "710", "710R1", "850", "850R1", "850/65R1",
  "1050/50R1 8P", "1050/65R1", "1050/65R1 13P", "1050/65R1 16P",
] as const;

const MB_4_1_OPTIONS = ["1050/65", "1550/65", "2450/65"] as const;

interface SafetyEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function SafetyEditor({
  category,
  getBomValue,
  setBomValue,
}: SafetyEditorProps) {
  const getText = (variant: string) =>
    getBomValue(category, variant).textVal ?? "";
  const getNum = (variant: string) =>
    getBomValue(category, variant).numVal;
  const setText = (variant: string, value: string) =>
    setBomValue(category, variant, { textVal: value || undefined });
  const setNum = (variant: string, value: string) =>
    setBomValue(category, variant, {
      numVal: value ? Number(value) : undefined,
    });

  const filledCount = [
    "Type", "DBG",
    "Main Pulley Specifications", "Main Pulley Quantity",
    "Counter Pulley Specifications", "Counter Pulley Quantity",
    "Diverter Pulley Specifications", "Diverter Pulley Quantity",
    "Counter Frame Rope/Belt", "Counter Frame Type", "Counter Frame Quantity",
    "Counter Guard Net Type", "Counter Guard Net Quantity",
    "Pit Ladder Quantity",
    "Machine Beam Home", "Machine Beam 2:1", "Machine Beam 4:1",
  ].filter((v) => {
    const val = getBomValue(category, v);
    return (val.numVal != null && val.numVal !== 0) || (val.textVal && val.textVal !== "");
  }).length;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium text-[var(--foreground)]">Safety</h3>
        {filledCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {filledCount}/17
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--muted-foreground)] mb-4">
        Safety gear, pulleys, counter frame, guard net and machine beams.
      </p>

      <div className="space-y-4">
        {/* Type & DBG */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              Type
            </label>
            <Select
              value={getText("Type")}
              onChange={(e) => setText("Type", e.target.value)}
              className="h-8 text-sm"
            >
              <option value="">--</option>
              {SAFETY_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              DBG
            </label>
            <Input
              type="text"
              value={getText("DBG")}
              onChange={(e) => setText("DBG", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Pulley Sub-section */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
            Pulley
          </h5>
          <div className="space-y-3">
            {(["Main", "Counter", "Diverter"] as const).map((prefix) => (
              <div key={prefix} className="grid grid-cols-[100px_1fr_120px] sm:grid-cols-[120px_1fr_150px] gap-3 items-end">
                <label className="text-xs font-medium text-[var(--foreground)] self-center">
                  {prefix}
                </label>
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                    Specifications
                  </label>
                  <Select
                    value={getText(`${prefix} Pulley Specifications`)}
                    onChange={(e) => setText(`${prefix} Pulley Specifications`, e.target.value)}
                    className="h-8 text-sm"
                  >
                    <option value="">--</option>
                    {PULLEY_SPEC_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                    Qty (pcs)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={getNum(`${prefix} Pulley Quantity`) ?? ""}
                    onChange={(e) => setNum(`${prefix} Pulley Quantity`, e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Counter Frame Sub-section */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
            Counter Frame
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                Rope / Belt
              </label>
              <Select
                value={getText("Counter Frame Rope/Belt")}
                onChange={(e) => setText("Counter Frame Rope/Belt", e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">--</option>
                {COUNTER_FRAME_ROPE_BELT_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                Type
              </label>
              <Select
                value={getText("Counter Frame Type")}
                onChange={(e) => setText("Counter Frame Type", e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">--</option>
                {COUNTER_FRAME_TYPE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                Qty (pcs)
              </label>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={getNum("Counter Frame Quantity") ?? ""}
                onChange={(e) => setNum("Counter Frame Quantity", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Counter Guard Net Sub-section */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
            Counter Guard Net
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                Type
              </label>
              <Select
                value={getText("Counter Guard Net Type")}
                onChange={(e) => setText("Counter Guard Net Type", e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">--</option>
                {COUNTER_GUARD_NET_TYPE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                Qty (pcs)
              </label>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={getNum("Counter Guard Net Quantity") ?? ""}
                onChange={(e) => setNum("Counter Guard Net Quantity", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Pit Ladder */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
            Pit Ladder
          </h5>
          <div className="w-40">
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              Qty (pcs)
            </label>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={getNum("Pit Ladder Quantity") ?? ""}
              onChange={(e) => setNum("Pit Ladder Quantity", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Machine Beam Sub-section */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
            Machine Beam
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                Home
              </label>
              <Select
                value={getText("Machine Beam Home")}
                onChange={(e) => setText("Machine Beam Home", e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">--</option>
                {MB_HOME_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                2:1
              </label>
              <Select
                value={getText("Machine Beam 2:1")}
                onChange={(e) => setText("Machine Beam 2:1", e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">--</option>
                {MB_2_1_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                4:1
              </label>
              <Select
                value={getText("Machine Beam 4:1")}
                onChange={(e) => setText("Machine Beam 4:1", e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">--</option>
                {MB_4_1_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
