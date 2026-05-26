"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const HEIGHT_OPTIONS = [
  "1900","2000","2100","2200","2300","2400",
  "2500","2600","2700","2800","2900","3000",
] as const;

const CAR_DOOR_TYPES = [
  "Collapsible","Manual Telescopic","Centre Opening",
  "Auto Telescopic","Auto Four-Fold","Biparted","Sensor",
] as const;

const LANDING_DOOR_TYPES = [
  "Collapsible","Manual Telescopic","Centre Opening",
  "Auto Telescopic","Auto Four-Fold","Biparted","Swing","Ecospace",
] as const;

const LANDING_TYPES_FOR_CAR: Record<string, readonly string[]> = {
  Collapsible: ["Collapsible","Swing"],
  "Manual Telescopic": ["Manual Telescopic"],
  "Centre Opening": ["Centre Opening"],
  "Auto Telescopic": ["Auto Telescopic"],
  "Auto Four-Fold": ["Auto Four-Fold"],
  Biparted: ["Biparted"],
  Sensor: ["Collapsible","Swing","Ecospace"],
};

const MATERIAL_REQUIRED_TYPES = new Set<string>([
  "Manual Telescopic","Centre Opening","Auto Telescopic",
  "Auto Four-Fold","Biparted",
]);

const MATERIAL_OPTIONS = [
  "MS","SS",
  "Golden","Honey Com","MOONROCK","Moonrock",
  "Rose Gold","Rose Gold Lilen","RoseGold",
  "Silver Miror","TI Black","Wodden AGWD-38","Champagne",
] as const;

const FRAME_MATERIAL_OPTIONS = MATERIAL_OPTIONS;

const HEADER_APPLICABLE_TYPES = new Set<string>([
  "Manual Telescopic","Centre Opening","Auto Telescopic","Auto Four-Fold",
]);

const LOCK_APPLICABLE_LANDING_TYPES = new Set<string>([
  "Collapsible","Manual Telescopic","Swing",
]);

const LOCK_TYPE_OPTIONS = [
  "B Type","O Type","Swing Door Lock LH","Swing Door Lock RH",
] as const;

const VISION_HIDDEN_TYPES = new Set<string>([
  "Collapsible","Manual Telescopic","Biparted","Ecospace",
]);

const VISION_OPTIONS = ["NV","PV","MV","LV","FV"] as const;

const OPENING_OPTIONS = [
  "600","650","700","750","800","900","1000",
  "1100","1200","1400","1600","1800","2000","2200","2400",
] as const;

const COLLAPSIBLE_OPENING_OPTIONS = [
  "850-D (6+1)","930-D (7+1)","980-D (8+1)","1100-D (9+1)",
  "1220-D (10+1)","1460-D (12+1)","1580-D (13+1)","1700-D (14+1)",
  "1820-D (15+1)","2180-D (17+1)","2400-D (18+1)","3020-D (25+1)",
  "3620-D (30+1)",
] as const;

const MT_OPENING_OPTIONS = ["700","800"] as const;

const AFF_OPENING_OPTIONS = [
  "1000L","1200L","1400L","1600L","1800L","2000L","2200L",
] as const;

const ORIENTATION_OPTIONS = ["LH","RH"] as const;
const ORIENTATION_APPLICABLE_TYPES = new Set<string>([
  "Collapsible","Manual Telescopic","Auto Telescopic","Swing","Ecospace",
]);

const MAX_DOORS = 2;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface BomValue {
  numVal?: number;
  textVal?: string;
}

interface Props {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function CarLandingDoorsEditor({ category, getBomValue, setBomValue }: Props) {
  const cat = category;

  const get = useCallback(
    (variant: string): string => {
      const v = getBomValue(cat, variant);
      if (v.textVal != null) return v.textVal;
      if (v.numVal != null) return String(v.numVal);
      return "";
    },
    [getBomValue, cat],
  );

  const setLeaf = useCallback(
    (variant: string, value: string) => {
      setBomValue(cat, variant, { textVal: value || undefined });
    },
    [setBomValue, cat],
  );

  const setNum = useCallback(
    (variant: string, value: string) => {
      setBomValue(cat, variant, { numVal: value ? Number(value) : undefined });
    },
    [setBomValue, cat],
  );

  const heightVal = get("Door Opening Height");
  const carCountRaw = get("Number of Car Doors");
  const carCount = Math.min(MAX_DOORS, Math.max(1, Number(carCountRaw) || 1));
  const landingCountRaw = get("Number of Landing Door Types");
  const landingCount = Math.min(MAX_DOORS, Math.max(1, Number(landingCountRaw) || 1));

  const [activeStep, setActiveStep] = useState<string>("setup");

  /* Auto-sync derived values */
  useEffect(() => {
    for (let i = 1; i <= MAX_DOORS; i++) {
      const lt = get(`Landing Door ${i} Type`);
      const ct = get(`Car Door ${i} Type`);

      // Collapsible & MT mirror opening from car to landing
      const mirrorTypes = new Set(["Collapsible", "Manual Telescopic"]);
      if (mirrorTypes.has(lt) && lt === ct) {
        const co = get(`Car Door ${i} Opening`);
        const lo = get(`Landing Door ${i} Opening`);
        if (co !== lo) setLeaf(`Landing Door ${i} Opening`, co);
      }

      // MT forces MS material
      if (ct === "Manual Telescopic") {
        if (get(`Car Door ${i} Material`) !== "MS") {
          setLeaf(`Car Door ${i} Material`, "MS");
        }
      }
      if (lt === "Manual Telescopic") {
        if (get(`Landing Door ${i} Material`) !== "MS") {
          setLeaf(`Landing Door ${i} Material`, "MS");
        }
      }

      // Mirror orientation for matching types
      if (lt === ct && ORIENTATION_APPLICABLE_TYPES.has(ct)) {
        const cOr = get(`Car Door ${i} Orientation`);
        const lOr = get(`Landing Door ${i} Orientation`);
        if (cOr !== lOr) setLeaf(`Landing Door ${i} Orientation`, cOr);
      }
    }
  }, [get, setLeaf]);

  /* Step list */
  const STEPS = useMemo(() => [
    { id: "setup", label: "Setup" },
    ...Array.from({ length: carCount }, (_, i) => ({
      id: `car-${i + 1}`,
      label: `Car Door ${i + 1}`,
    })),
    ...Array.from({ length: landingCount }, (_, i) => ({
      id: `landing-${i + 1}`,
      label: `Landing ${i + 1}`,
    })),
    { id: "frames", label: "Frames & Lintons" },
    { id: "headers", label: "Headers" },
    { id: "lock", label: "Door Lock" },
    { id: "summary", label: "Summary" },
  ], [carCount, landingCount]);

  // Reset step if it no longer exists (e.g. user reduced door count)
  useEffect(() => {
    if (!STEPS.some((s) => s.id === activeStep)) {
      setActiveStep("setup");
    }
  }, [STEPS, activeStep]);

  /* Summary rows */
  const summaryRows = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    rows.push({ label: "Fire Rated", value: get("Fire Rated") || "No" });
    rows.push({ label: "Opening Height", value: heightVal ? `${heightVal} mm` : "—" });

    for (let i = 1; i <= carCount; i++) {
      const ct = get(`Car Door ${i} Type`);
      if (!ct) continue;
      const parts = [ct];
      const mat = get(`Car Door ${i} Material`);
      if (mat) parts.push(mat);
      const vis = get(`Car Door ${i} Vision`);
      if (vis) parts.push(vis);
      const orient = get(`Car Door ${i} Orientation`);
      if (orient) parts.push(orient);
      const opening = get(`Car Door ${i} Opening`);
      if (opening) parts.push(opening);
      rows.push({ label: `Car Door ${i}`, value: parts.join(" / ") });
    }

    for (let i = 1; i <= landingCount; i++) {
      const lt = get(`Landing Door ${i} Type`);
      if (!lt) continue;
      const parts = [lt];
      const mat = get(`Landing Door ${i} Material`);
      if (mat) parts.push(mat);
      const vis = get(`Landing Door ${i} Vision`);
      if (vis) parts.push(vis);
      const orient = get(`Landing Door ${i} Orientation`);
      if (orient) parts.push(orient);
      const opening = get(`Landing Door ${i} Opening`);
      if (opening) parts.push(opening);
      const qty = get(`Landing Door ${i} Quantity`);
      if (qty) parts.push(`x${qty}`);
      rows.push({ label: `Landing Door ${i}`, value: parts.join(" / ") });

      const frameMat = get(`Landing Door Frame ${i} Material`);
      if (frameMat) rows.push({ label: `Frame ${i}`, value: frameMat });
    }

    for (let i = 1; i <= carCount; i++) {
      const ct = get(`Car Door ${i} Type`);
      if (ct && HEADER_APPLICABLE_TYPES.has(ct)) {
        rows.push({ label: `Car Header ${i}`, value: `Applicable (${ct})` });
      }
    }
    for (let i = 1; i <= landingCount; i++) {
      const lt = get(`Landing Door ${i} Type`);
      if (lt && HEADER_APPLICABLE_TYPES.has(lt)) {
        rows.push({ label: `Landing Header ${i}`, value: `Applicable (${lt})` });
      }
    }

    const lockType = get("Door Lock Type");
    if (lockType) {
      const lockQty = get("Door Lock Quantity");
      rows.push({ label: "Door Lock", value: `${lockType}${lockQty ? ` x${lockQty}` : ""}` });
    }

    return rows;
  }, [get, heightVal, carCount, landingCount]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">Car & Landing Doors</h3>
        <span className="text-xs text-[var(--muted-foreground)]">Wizard</span>
      </div>

      {/* Step navigation pills */}
      <div className="flex flex-wrap gap-1 mb-3">
        {STEPS.map((step) => {
          let hint = "";
          if (step.id.startsWith("car-") || step.id.startsWith("landing-")) {
            const idx = parseInt(step.id.split("-")[1] ?? "0");
            const prefix = step.id.startsWith("car") ? "Car" : "Landing";
            const t = get(`${prefix} Door ${idx} Type`);
            if (t) hint = ` (${t.slice(0, 3)})`;
          }
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors ${
                activeStep === step.id
                  ? "bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30"
              }`}
            >
              {step.label}{hint}
            </button>
          );
        })}
      </div>

      {/* ── Step: Setup ──────────────────────────────────────────── */}
      {activeStep === "setup" && (
        <WizardCard title="Step 1: Basic Setup" onNext={() => setActiveStep("car-1")}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <DoorField label="Fire-Rated Door">
              <div className="flex gap-1.5 mt-0.5">
                <PillButton label="No" active={get("Fire Rated") !== "Yes"} onClick={() => setLeaf("Fire Rated", "No")} small />
                <PillButton label="Yes" active={get("Fire Rated") === "Yes"} onClick={() => setLeaf("Fire Rated", "Yes")} small />
              </div>
            </DoorField>
            <DoorField label="Opening Height (mm)">
              <Select value={heightVal} onChange={(e) => setLeaf("Door Opening Height", e.target.value)} className="w-full h-8 text-sm">
                <option value="">-- Select --</option>
                {HEIGHT_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </Select>
            </DoorField>
            <DoorField label="Number of Car Doors">
              <Select value={carCountRaw || "1"} onChange={(e) => setLeaf("Number of Car Doors", e.target.value)} className="w-full h-8 text-sm">
                {[1, 2].map((n) => <option key={n} value={String(n)}>{n}</option>)}
              </Select>
            </DoorField>
            <DoorField label="Number of Landing Door Types">
              <Select value={landingCountRaw || "1"} onChange={(e) => setLeaf("Number of Landing Door Types", e.target.value)} className="w-full h-8 text-sm">
                {[1, 2].map((n) => <option key={n} value={String(n)}>{n}</option>)}
              </Select>
            </DoorField>
          </div>
        </WizardCard>
      )}

      {/* ── Steps: Car Doors ─────────────────────────────────────── */}
      {Array.from({ length: carCount }, (_, idx) => {
        const n = idx + 1;
        const stepId = `car-${n}`;
        if (activeStep !== stepId) return null;
        const typeVal = get(`Car Door ${n} Type`);
        const needsMaterial = MATERIAL_REQUIRED_TYPES.has(typeVal);
        const showsVision = typeVal !== "" && !VISION_HIDDEN_TYPES.has(typeVal);
        const hasOrientation = ORIENTATION_APPLICABLE_TYPES.has(typeVal);
        const opening = get(`Car Door ${n} Opening`);
        const vision = get(`Car Door ${n} Vision`);
        const orient = get(`Car Door ${n} Orientation`);
        const nextStep = n < carCount ? `car-${n + 1}` : "landing-1";

        return (
          <WizardCard
            key={stepId}
            title={`Car Door ${n}`}
            onBack={() => setActiveStep(n === 1 ? "setup" : `car-${n - 1}`)}
            onNext={() => setActiveStep(nextStep)}
          >
            <div className="space-y-3">
              {/* Type selection — pill buttons */}
              <div>
                <p className="text-xs font-medium text-[var(--foreground)] mb-1.5">Door Type</p>
                <div className="flex flex-wrap gap-1.5">
                  {CAR_DOOR_TYPES.map((t) => (
                    <PillButton
                      key={t}
                      label={t}
                      active={typeVal === t}
                      onClick={() => {
                        setLeaf(`Car Door ${n} Type`, typeVal === t ? "" : t);
                        if (typeVal !== t) {
                          setLeaf(`Car Door ${n} Material`, "");
                          setLeaf(`Car Door ${n} Vision`, "");
                          setLeaf(`Car Door ${n} Opening`, "");
                          setLeaf(`Car Door ${n} Orientation`, "");
                        }
                      }}
                    />
                  ))}
                </div>
              </div>

              {typeVal && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {needsMaterial && (
                    <DoorField label="Material">
                      <Select
                        value={get(`Car Door ${n} Material`)}
                        onChange={(e) => setLeaf(`Car Door ${n} Material`, e.target.value)}
                        className="w-full h-8 text-sm"
                      >
                        <option value="">--</option>
                        {MATERIAL_OPTIONS.map((m) => (
                          <option key={m} value={m} disabled={typeVal === "Manual Telescopic" && m !== "MS"}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </DoorField>
                  )}
                  {showsVision && (
                    <DoorField label="Vision">
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {VISION_OPTIONS.map((v) => (
                          <PillButton
                            key={v}
                            label={v}
                            active={vision === v}
                            onClick={() => setLeaf(`Car Door ${n} Vision`, vision === v ? "" : v)}
                            small
                          />
                        ))}
                      </div>
                    </DoorField>
                  )}
                  {hasOrientation && (
                    <DoorField label="Orientation">
                      <div className="flex gap-1 mt-0.5">
                        {ORIENTATION_OPTIONS.map((o) => (
                          <PillButton
                            key={o}
                            label={o}
                            active={orient === o}
                            onClick={() => setLeaf(`Car Door ${n} Orientation`, orient === o ? "" : o)}
                            small
                          />
                        ))}
                      </div>
                    </DoorField>
                  )}
                  <DoorField label="Opening (mm)">
                    <Select
                      value={opening}
                      onChange={(e) => setLeaf(`Car Door ${n} Opening`, e.target.value)}
                      className="w-full h-8 text-sm"
                    >
                      <option value="">--</option>
                      {getOpeningOptions(typeVal).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </Select>
                  </DoorField>
                </div>
              )}
            </div>
          </WizardCard>
        );
      })}

      {/* ── Steps: Landing Doors ─────────────────────────────────── */}
      {Array.from({ length: landingCount }, (_, idx) => {
        const n = idx + 1;
        const stepId = `landing-${n}`;
        if (activeStep !== stepId) return null;
        const typeVal = get(`Landing Door ${n} Type`);
        const needsMaterial = MATERIAL_REQUIRED_TYPES.has(typeVal);
        const showsVision = typeVal !== "" && !VISION_HIDDEN_TYPES.has(typeVal);
        const hasOrientation = ORIENTATION_APPLICABLE_TYPES.has(typeVal);
        const opening = get(`Landing Door ${n} Opening`);
        const vision = get(`Landing Door ${n} Vision`);
        const orient = get(`Landing Door ${n} Orientation`);
        const carType = get(`Car Door ${n} Type`);

        const isCollapsibleMirror = typeVal === "Collapsible" && carType === "Collapsible";
        const isMTMirror = typeVal === "Manual Telescopic" && carType === "Manual Telescopic";
        const isMirror = isCollapsibleMirror || isMTMirror;

        const nextStep = n < landingCount ? `landing-${n + 1}` : "frames";

        return (
          <WizardCard
            key={stepId}
            title={`Landing Door ${n}`}
            onBack={() => setActiveStep(n === 1 ? `car-${carCount}` : `landing-${n - 1}`)}
            onNext={() => setActiveStep(nextStep)}
          >
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-[var(--foreground)] mb-1.5">Door Type</p>
                <div className="flex flex-wrap gap-1.5">
                  {LANDING_DOOR_TYPES.map((t) => {
                    const allowed = carType === "" || (LANDING_TYPES_FOR_CAR[carType] ?? []).includes(t);
                    return (
                      <PillButton
                        key={t}
                        label={t}
                        active={typeVal === t}
                        disabled={!allowed}
                        onClick={() => {
                          setLeaf(`Landing Door ${n} Type`, typeVal === t ? "" : t);
                          if (typeVal !== t) {
                            setLeaf(`Landing Door ${n} Material`, "");
                            setLeaf(`Landing Door ${n} Vision`, "");
                            setLeaf(`Landing Door ${n} Opening`, "");
                            setLeaf(`Landing Door ${n} Orientation`, "");
                          }
                        }}
                      />
                    );
                  })}
                </div>
                {carType && (
                  <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                    Filtered by Car Door {n}: {carType}
                  </p>
                )}
              </div>

              {typeVal && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {needsMaterial && (
                    <DoorField label="Material">
                      <Select
                        value={get(`Landing Door ${n} Material`)}
                        onChange={(e) => setLeaf(`Landing Door ${n} Material`, e.target.value)}
                        className="w-full h-8 text-sm"
                      >
                        <option value="">--</option>
                        {MATERIAL_OPTIONS.map((m) => (
                          <option key={m} value={m} disabled={typeVal === "Manual Telescopic" && m !== "MS"}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </DoorField>
                  )}
                  {showsVision && (
                    <DoorField label="Vision">
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {VISION_OPTIONS.map((v) => (
                          <PillButton key={v} label={v} active={vision === v}
                            onClick={() => setLeaf(`Landing Door ${n} Vision`, vision === v ? "" : v)} small />
                        ))}
                      </div>
                    </DoorField>
                  )}
                  {hasOrientation && (
                    <DoorField label="Orientation">
                      <div className="flex gap-1 mt-0.5">
                        {ORIENTATION_OPTIONS.map((o) => (
                          <PillButton key={o} label={o} active={orient === o}
                            onClick={() => setLeaf(`Landing Door ${n} Orientation`, orient === o ? "" : o)} small />
                        ))}
                      </div>
                    </DoorField>
                  )}
                  <DoorField label={isMirror ? "Opening (mirrored)" : "Opening (mm)"}>
                    {isMirror ? (
                      <Input type="text" disabled value={get(`Car Door ${n} Opening`) || "—"} className="w-full h-8 text-sm opacity-70" />
                    ) : (
                      <Select
                        disabled={typeVal === "Ecospace"}
                        value={opening}
                        onChange={(e) => setLeaf(`Landing Door ${n} Opening`, e.target.value)}
                        className="w-full h-8 text-sm"
                      >
                        <option value="">--</option>
                        {getOpeningOptions(typeVal).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </Select>
                    )}
                  </DoorField>
                  <DoorField label="Quantity (pcs)">
                    <Input
                      type="number"
                      min={0}
                      value={get(`Landing Door ${n} Quantity`)}
                      onChange={(e) => setNum(`Landing Door ${n} Quantity`, e.target.value)}
                      className="w-full h-8 text-sm"
                    />
                  </DoorField>
                </div>
              )}
            </div>
          </WizardCard>
        );
      })}

      {/* ── Step: Frames & Lintons ───────────────────────────────── */}
      {activeStep === "frames" && (
        <WizardCard
          title="Frames & Lintons"
          onBack={() => setActiveStep(`landing-${landingCount}`)}
          onNext={() => setActiveStep("headers")}
        >
          <div className="space-y-3">
            {Array.from({ length: landingCount }, (_, idx) => {
              const n = idx + 1;
              const lt = get(`Landing Door ${n} Type`);
              const hasOrientation = ORIENTATION_APPLICABLE_TYPES.has(lt);
              const orient = hasOrientation ? get(`Landing Door ${n} Orientation`) : null;
              const opening = get(`Landing Door ${n} Opening`);

              return (
                <div key={n} className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3 space-y-2">
                  <span className="text-sm font-medium">Door Frame {n}
                    <span className="text-xs text-[var(--muted-foreground)] ml-2">{lt || "no type"}</span>
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <DoorField label="Height (mm)">
                      <Input type="text" disabled value={heightVal || "—"} className="w-full h-8 text-sm opacity-70" />
                    </DoorField>
                    <DoorField label="Type">
                      <Input type="text" disabled value={lt || "—"} className="w-full h-8 text-sm opacity-70" />
                    </DoorField>
                    <DoorField label="Material">
                      <Select
                        value={get(`Landing Door Frame ${n} Material`)}
                        onChange={(e) => setLeaf(`Landing Door Frame ${n} Material`, e.target.value)}
                        className="w-full h-8 text-sm"
                      >
                        <option value="">--</option>
                        {FRAME_MATERIAL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </Select>
                    </DoorField>
                    <DoorField label="Opening Side">
                      <Input type="text" disabled value={hasOrientation ? orient || "—" : "N/A"} className="w-full h-8 text-sm opacity-70" />
                    </DoorField>
                  </div>
                </div>
              );
            })}
          </div>
        </WizardCard>
      )}

      {/* ── Step: Header Systems ─────────────────────────────────── */}
      {activeStep === "headers" && (
        <WizardCard
          title="Header Systems"
          onBack={() => setActiveStep("frames")}
          onNext={() => setActiveStep("lock")}
        >
          <p className="text-xs text-[var(--muted-foreground)] mb-2">
            Headers apply to: Manual Telescopic, Centre Opening, Auto Telescopic, Auto Four-Fold
          </p>
          <div className="space-y-2">
            {Array.from({ length: carCount }, (_, idx) => {
              const n = idx + 1;
              const ct = get(`Car Door ${n} Type`);
              const applicable = HEADER_APPLICABLE_TYPES.has(ct);
              return (
                <div key={`car-h-${n}`}
                  className={`flex items-center gap-3 rounded-md bg-[var(--muted)]/30 px-3 py-2 ${!applicable ? "opacity-40" : ""}`}
                >
                  <span className="text-sm font-medium min-w-[8rem]">Car Header {n}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{applicable ? ct : "N/A"}</span>
                  {applicable && <span className="ml-auto text-xs text-green-600 font-medium">Applicable</span>}
                </div>
              );
            })}
            {Array.from({ length: landingCount }, (_, idx) => {
              const n = idx + 1;
              const lt = get(`Landing Door ${n} Type`);
              const applicable = HEADER_APPLICABLE_TYPES.has(lt);
              return (
                <div key={`land-h-${n}`}
                  className={`flex items-center gap-3 rounded-md bg-[var(--muted)]/30 px-3 py-2 ${!applicable ? "opacity-40" : ""}`}
                >
                  <span className="text-sm font-medium min-w-[8rem]">Landing Header {n}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{applicable ? lt : "N/A"}</span>
                  {applicable && <span className="ml-auto text-xs text-green-600 font-medium">Applicable</span>}
                </div>
              );
            })}
          </div>
        </WizardCard>
      )}

      {/* ── Step: Door Lock ──────────────────────────────────────── */}
      {activeStep === "lock" && (() => {
        let lockApplicable = false;
        for (let i = 1; i <= landingCount; i++) {
          if (LOCK_APPLICABLE_LANDING_TYPES.has(get(`Landing Door ${i} Type`))) {
            lockApplicable = true;
            break;
          }
        }
        return (
          <WizardCard
            title="Door Lock"
            onBack={() => setActiveStep("headers")}
            onNext={() => setActiveStep("summary")}
          >
            <div className={`grid grid-cols-2 gap-3 ${!lockApplicable ? "opacity-40" : ""}`}>
              <DoorField label="Lock Type">
                <Select
                  disabled={!lockApplicable}
                  value={get("Door Lock Type")}
                  onChange={(e) => setLeaf("Door Lock Type", e.target.value)}
                  className="w-full h-8 text-sm"
                >
                  <option value="">--</option>
                  {LOCK_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </DoorField>
              <DoorField label="Quantity (pcs)">
                <Input
                  type="number"
                  min={0}
                  disabled={!lockApplicable}
                  value={get("Door Lock Quantity")}
                  onChange={(e) => setNum("Door Lock Quantity", e.target.value)}
                  className="w-full h-8 text-sm"
                />
              </DoorField>
            </div>
            {!lockApplicable && (
              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                Lock only applies when a landing door is Collapsible, Manual Telescopic, or Swing.
              </p>
            )}
          </WizardCard>
        );
      })()}

      {/* ── Step: Summary ────────────────────────────────────────── */}
      {activeStep === "summary" && (
        <WizardCard title="Door Configuration Summary" onBack={() => setActiveStep("lock")}>
          {summaryRows.length <= 2 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No door selections made yet. Go back and configure doors.
            </p>
          ) : (
            <div className="space-y-1">
              {summaryRows.map((r, i) => (
                <div key={i} className="flex items-center gap-3 rounded bg-[var(--muted)]/30 px-3 py-1.5">
                  <span className="text-sm font-medium min-w-[10rem]">{r.label}</span>
                  <span className="text-sm text-[var(--muted-foreground)] font-mono">{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </WizardCard>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getOpeningOptions(doorType: string): readonly string[] {
  switch (doorType) {
    case "Collapsible": return COLLAPSIBLE_OPENING_OPTIONS;
    case "Manual Telescopic": return MT_OPENING_OPTIONS;
    case "Auto Four-Fold": return AFF_OPENING_OPTIONS;
    default: return OPENING_OPTIONS;
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function WizardCard({ title, onBack, onNext, children }: {
  title: string;
  onBack?: () => void;
  onNext?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">{title}</h4>
        <div className="flex gap-1.5">
          {onBack && (
            <button type="button" onClick={onBack}
              className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--muted)]">
              Back
            </button>
          )}
          {onNext && (
            <button type="button" onClick={onNext}
              className="text-xs font-medium text-[var(--primary)] hover:underline px-2 py-0.5">
              Next &rarr;
            </button>
          )}
        </div>
      </div>
      <div className="rounded-md bg-[var(--muted)]/20 border border-[var(--border)] p-3">{children}</div>
    </div>
  );
}

function PillButton({ label, active, disabled, onClick, small }: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded border transition-colors font-medium ${
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      } ${
        active
          ? "bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm"
          : disabled
            ? "bg-[var(--muted)] text-[var(--muted-foreground)]/40 border-[var(--border)]/30 cursor-not-allowed"
            : "bg-[var(--muted)] text-[var(--foreground)] border-[var(--border)] hover:border-[var(--primary)]/60 hover:text-[var(--primary)]"
      }`}
    >
      {label}
    </button>
  );
}

function DoorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] truncate">{label}</span>
      {children}
    </label>
  );
}
