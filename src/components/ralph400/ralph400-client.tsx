"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  CircleAlert,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  Ruler,
  Save,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeader } from "@/components/ui/card";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { exportSheetsToXlsx } from "@/lib/export/xlsx";
import { useOperator } from "@/lib/jobs/use-operator";
import { cn } from "@/lib/utils";
import { getRalph400Autofill } from "@/lib/actions/ralph400-autofill";
import { getRalph400PartList, saveRalph400PartList } from "@/lib/actions/ralph400";
import { DEFAULTS, FLOOR_FIELDS, OPTIONS, type Ralph400Inputs } from "@/lib/ralph400/model";
import {
  buildPartList,
  MAX_STOPS,
  SECTIONS,
  type InputIssue,
  type PartLine,
  type SectionKey,
} from "@/lib/ralph400/part-list";

/* The working copy lives in this browser so a reload keeps unsaved edits. The
   copy other people see is the one saved against the job (ralph400_part_lists). */
const STORE = "ralph400.workspace.v2";
const OLD_STORE = "ralph400.inputs";

export interface FactoryJobOption {
  job_number: string;
  customer_name: string | null;
  drive_type: string | null;
  floors: number | null;
}

type Source = "saved" | "drawing" | "stored-drawing" | "job" | "edited" | "sample";
type Sources = Partial<Record<keyof Ralph400Inputs, Source>>;
type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "new" }
  | { kind: "saved"; savedAt: string; savedBy: string | null };

const BLANK: Ralph400Inputs = {
  jobNo: "",
  shaftWidth: 0,
  shaftDepth: 0,
  pitHeight: 0,
  overHead: 0,
  floors: 0,
  h1: 0,
  h2: 0,
  h3: 0,
  h4: 0,
  h5: 0,
  cwt: "",
  doorType: "",
  doorOpening: "",
};

const FIELDS = (Object.keys(BLANK) as (keyof Ralph400Inputs)[]).filter((k) => k !== "jobNo");
const allFrom = (s: Source): Sources => Object.fromEntries(FIELDS.map((k) => [k, s]));

const SOURCE_TAG: Record<Source, { label: string; cls: string; title: string }> = {
  saved: {
    label: "saved",
    cls: "text-emerald-700 bg-emerald-50",
    title: "From the part list saved for this job",
  },
  "stored-drawing": {
    label: "drawing",
    cls: "text-sky-700 bg-sky-50",
    title: "Read from the job's GA drawing scan — check it",
  },
  drawing: {
    label: "drawing",
    cls: "text-sky-700 bg-sky-50",
    title: "Read from the job's GA drawing — check it",
  },
  job: {
    label: "job",
    cls: "text-slate-600 bg-slate-100",
    title: "From the job record",
  },
  edited: {
    label: "edited",
    cls: "text-amber-700 bg-amber-50",
    title: "Changed by hand",
  },
  sample: {
    label: "sample",
    cls: "text-slate-600 bg-slate-100",
    title: "Sample value, not from a job",
  },
};

const SECTION_BAND: Record<SectionKey, string> = {
  verticals: "border-l-slate-400",
  console: "border-l-violet-400",
  glass: "border-l-sky-400",
  cladding: "border-l-orange-400",
  channels: "border-l-slate-400",
  hardware: "border-l-emerald-400",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function Ralph400Client({ jobs }: { jobs: FactoryJobOption[] }) {
  const toast = useToast();
  const { ensureOperator } = useOperator();
  const [inp, setInp] = useState<Ralph400Inputs>(BLANK);
  const [sources, setSources] = useState<Sources>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The inputs as last saved, to tell "Saved" from "Unsaved changes".
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [sample, setSample] = useState(false);
  const [showNotNeeded, setShowNotNeeded] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "refill">("");
  // Restored after mount, never during render, so server and client paint agree.
  const [hydrated, setHydrated] = useState(false);
  // Picking job A then quickly job B must not let A's slower reply land on B.
  const req = useRef(0);

  const job = jobs.find((j) => j.job_number === inp.jobNo) ?? null;
  const active = !!job || sample;

  const loadSavedStatus = async (jobNo: string, r: number) => {
    try {
      const saved = await getRalph400PartList(jobNo);
      if (r !== req.current) return;
      if (saved) {
        setStatus({ kind: "saved", savedAt: saved.savedAt, savedBy: saved.savedBy });
        setSnapshot(JSON.stringify({ ...BLANK, ...saved.inputs, jobNo }));
      } else setStatus({ kind: "new" });
    } catch {
      if (r === req.current) setStatus({ kind: "new" });
    }
  };

  useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_STORE);
      const raw = window.localStorage.getItem(STORE);
      if (raw) {
        const ws = JSON.parse(raw) as { inp?: Ralph400Inputs; sources?: Sources; sample?: boolean };
        if (ws.inp && (ws.sample || jobs.some((j) => j.job_number === ws.inp?.jobNo))) {
          setInp({ ...BLANK, ...ws.inp });
          setSources(ws.sources ?? {});
          setSample(!!ws.sample);
          if (!ws.sample) {
            setStatus({ kind: "loading" });
            void loadSavedStatus(ws.inp.jobNo, ++req.current);
          }
        }
      }
    } catch {
      /* private mode / blocked storage */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ inp, sources, sample }));
    } catch {
      /* ignore */
    }
  }, [inp, sources, sample, hydrated]);

  /* ---- pick a job: its saved list if there is one, else the drawing scan ---- */
  const pickJob = async (jobNo: string) => {
    const r = ++req.current;
    const j = jobs.find((x) => x.job_number === jobNo);
    const base: Ralph400Inputs = { ...BLANK, jobNo, floors: j?.floors ?? 0 };
    setSample(false);
    setInp(base);
    setSources(j?.floors ? { floors: "job" } : {});
    setSnapshot(null);
    setStatus({ kind: "loading" });
    try {
      const saved = await getRalph400PartList(jobNo);
      if (r !== req.current) return;
      if (saved) {
        const next = { ...BLANK, ...saved.inputs, jobNo };
        setInp(next);
        setSources(allFrom("saved"));
        setSnapshot(JSON.stringify(next));
        setStatus({ kind: "saved", savedAt: saved.savedAt, savedBy: saved.savedBy });
        return;
      }
      // Free tier only (job record + stored drawing scans) — instant, no AI.
      const a = await getRalph400Autofill(jobNo, false);
      if (r !== req.current) return;
      if (a.ok) {
        setInp({ ...base, ...a.values, jobNo });
        setSources((s) => ({ ...s, ...(a.sources as Sources) }));
        a.warnings.forEach((w) => toast.info(w));
      }
    } catch {
      if (r === req.current) toast.error("Could not load this job's data — fill the inputs by hand.");
    }
    if (r === req.current) setStatus({ kind: "new" });
  };

  const refill = async () => {
    if (!job) return;
    const r = req.current;
    setBusy("refill");
    try {
      const a = await getRalph400Autofill(inp.jobNo, true);
      if (r !== req.current) return;
      if (!a.ok) {
        toast.error(a.error);
        return;
      }
      setInp((p) => ({ ...p, ...a.values, jobNo: p.jobNo }));
      setSources((s) => ({ ...s, ...(a.sources as Sources) }));
      const n = Object.keys(a.values).length;
      toast.success(`Refilled ${n} input${n === 1 ? "" : "s"} from the drawing — check them, then save.`);
      a.warnings.forEach((w) => toast.info(w));
    } catch {
      toast.error("Reading the drawing failed — fill the inputs by hand.");
    } finally {
      setBusy("");
    }
  };

  const setField = (k: keyof Ralph400Inputs, v: string | number) => {
    setInp((p) => ({ ...p, [k]: v }));
    setSources((s) => ({ ...s, [k]: sample ? "sample" : "edited" }));
  };
  const setNum = (k: keyof Ralph400Inputs, raw: string) => {
    const n = raw.trim() === "" ? 0 : Number(raw);
    setField(k, isFinite(n) ? n : 0);
  };

  const result = useMemo(() => buildPartList(inp, { driveType: job?.drive_type }), [inp, job?.drive_type]);
  const needed = useMemo(() => result.lines.filter((l) => !l.notNeeded), [result]);
  const dirty = status.kind === "saved" && snapshot !== JSON.stringify(inp);
  const issueFor = (k: keyof Ralph400Inputs) =>
    result.issues.find((i) => i.field === k && i.level === "error") ?? result.issues.find((i) => i.field === k);

  const save = async () => {
    if (!job) return;
    if (result.blocked) {
      toast.error("Fix the inputs marked in red before saving.");
      return;
    }
    ensureOperator(); // puts a name on the save; saving still works without one
    setBusy("save");
    try {
      const r = await saveRalph400PartList(inp.jobNo, inp, result.lines, result.pieces);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSnapshot(JSON.stringify(inp));
      setSources((s) => Object.fromEntries(Object.keys(s).map((k) => [k, "saved"])) as Sources);
      setStatus({ kind: "saved", savedAt: r.savedAt, savedBy: r.savedBy });
      toast.success(`Part list saved for ${inp.jobNo} — ${needed.length} lines, ${result.pieces.toLocaleString("en-IN")} pieces.`);
    } catch {
      toast.error("Could not save — check the connection and try again.");
    } finally {
      setBusy("");
    }
  };

  const startSample = () => {
    req.current++;
    setSample(true);
    setInp({ ...DEFAULTS, jobNo: "" });
    setSources(allFrom("sample"));
    setSnapshot(null);
    setStatus({ kind: "idle" });
  };

  const exportXlsx = () => {
    const cols = ["#", "Section", "Code", "Part", "Drawing", "Level", "Face", "Size (mm)", "Qty", "Piece mark", "Notes"];
    exportSheetsToXlsx<Record<string, string | number>>({
      filename: `RALPH400-part-list-${(inp.jobNo || "sample").replace(/[^\w-]+/g, "_")}`,
      sheets: [
        {
          name: "Part list",
          rows: needed.map((l, i) => ({
            "#": i + 1,
            Section: SECTIONS.find((s) => s.key === l.section)?.title ?? l.section,
            Code: l.code ?? "",
            Part: l.part,
            Drawing: l.drawing ?? "",
            Level: l.level ?? "",
            Face: l.face ?? "",
            "Size (mm)": l.size,
            Qty: l.qty,
            "Piece mark": l.mark ?? "",
            Notes: [
              l.bracket ? "Bracket version" : "",
              l.note ?? "",
            ]
              .filter(Boolean)
              .join(" · "),
          })),
          columns: cols.map((h) => ({ header: h, field: h })),
        },
        {
          name: "Inputs",
          rows: inputRows(inp, job).map(([k, v]) => ({ Input: k, Value: v })),
          columns: [
            { header: "Input", field: "Input" },
            { header: "Value", field: "Value" },
          ],
        },
      ],
    });
  };

  const stops = Math.max(0, Math.min(MAX_STOPS, Math.round(inp.floors || 0)));
  const rises = FLOOR_FIELDS.slice(0, Math.max(0, stops - 1));
  // Heights filled beyond the stop count stay visible so the warning has a field to point at.
  const extraRises = FLOOR_FIELDS.filter(([k], i) => i >= rises.length && inp[k] > 0);
  // Overhead cladding covers all four faces on every job, so the tile shows only
  // the faces clad along the shaft — the part that changes with the counterweight.
  const shaftCladding = [
    ...new Set(needed.filter((l) => l.section === "cladding" && l.level !== "OVERHEAD" && l.face).map((l) => l.face as string)),
  ];

  return (
    <div>
      <PageHeader
        icon={<Ruler size={18} />}
        title="RALPH 400 Structure Part List"
        subtitle="Pick a job — its external shaft structure part list is built from the shaft size, floors and counterweight side."
        className="mb-2 print:hidden"
      />

      {/* ---------------- job bar ---------------- */}
      <Card className="mb-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          <div className="w-full sm:w-[26rem]">
            <JobPicker jobs={jobs} value={inp.jobNo} onPick={pickJob} />
          </div>
          {active && <StatusPill status={status} dirty={dirty} sample={sample} />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {job && (
              <Button
                variant="ghost"
                size="sm"
                onClick={refill}
                disabled={busy !== "" || status.kind === "loading"}
                title="Read this job's GA drawing with AI and refill the inputs (overwrites what it finds)"
              >
                <RefreshCw size={14} className={cn(busy === "refill" && "animate-spin")} />
                {busy === "refill" ? "Reading drawing…" : "Re-read drawing"}
              </Button>
            )}
            {active && (
              <>
                <Button variant="secondary" size="sm" onClick={exportXlsx} disabled={result.blocked}>
                  <FileSpreadsheet size={14} /> Excel
                </Button>
                <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={result.blocked}>
                  <Printer size={14} /> Print
                </Button>
              </>
            )}
            {job && (
              <Button
                size="sm"
                onClick={save}
                disabled={busy !== "" || status.kind === "loading" || (status.kind === "saved" && !dirty)}
                title={result.blocked ? "Fix the inputs marked in red first" : "Save this part list against the job"}
              >
                <Save size={14} />
                {busy === "save" ? "Saving…" : status.kind === "saved" && !dirty ? "Saved" : "Save part list"}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {!active ? (
        <Card className="print:hidden">
          <EmptyState
            icon={<Ruler size={28} />}
            title="Pick a job to create its structure part list"
            description={`${jobs.length} active jobs have a factory-made structure. Picking one loads its saved part list, or fills the inputs from its GA drawing scan for you to check and save.`}
            action={
              <Button variant="ghost" size="sm" className="mt-3" onClick={startSample}>
                Or try it with sample sizes
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-2 lg:grid-cols-[17rem_minmax(0,1fr)] print:hidden">
          {/* ---------------- inputs ---------------- */}
          <Card className="lg:sticky lg:top-4">
            <SectionHeader title="Inputs" count={status.kind === "loading" ? "loading…" : "tag = where the value came from"} />
            <div className="space-y-2.5 p-2">
              <Group title="Structure outer size">
                <NumRow label="Width" unit="mm" k="shaftWidth" inp={inp} sources={sources} issue={issueFor("shaftWidth")} onChange={setNum} />
                <NumRow label="Depth" unit="mm" k="shaftDepth" inp={inp} sources={sources} issue={issueFor("shaftDepth")} onChange={setNum} />
                <NumRow label="Pit height" unit="mm" k="pitHeight" inp={inp} sources={sources} issue={issueFor("pitHeight")} onChange={setNum} />
                <NumRow label="Over head" unit="mm" k="overHead" inp={inp} sources={sources} issue={issueFor("overHead")} onChange={setNum} />
              </Group>
              <Group title="Floors">
                <NumRow label="Stops" k="floors" inp={inp} sources={sources} issue={issueFor("floors")} onChange={setNum} />
                {rises.map(([k, label]) => (
                  <NumRow key={k} label={label} unit="mm" k={k} inp={inp} sources={sources} issue={issueFor(k)} onChange={setNum} />
                ))}
                {extraRises.map(([k, label]) => (
                  <NumRow key={k} label={label} unit="mm" k={k} inp={inp} sources={sources} issue={issueFor(k)} onChange={setNum} />
                ))}
                {rises.length === 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">Enter the number of stops to see the floor heights.</p>
                )}
              </Group>
              <Group title="Configuration">
                <SelectRow label="Counterweight" k="cwt" options={OPTIONS.cwt} inp={inp} sources={sources} issue={issueFor("cwt")} onChange={setField} />
                <SelectRow label="Door type" k="doorType" options={OPTIONS.doorType} inp={inp} sources={sources} issue={issueFor("doorType")} onChange={setField} />
                <SelectRow label="Door opening" k="doorOpening" options={OPTIONS.doorOpening} inp={inp} sources={sources} issue={issueFor("doorOpening")} onChange={setField} />
              </Group>
            </div>
          </Card>

          {/* ---------------- output ---------------- */}
          <div className="min-w-0 space-y-2">
            {result.issues.length > 0 && <IssuesCard issues={result.issues} />}

            <StatStrip>
              <StatTile className="px-3 py-1"
                label="Part lines"
                value={result.blocked ? "—" : needed.length}
                tone={result.blocked ? "danger" : "default"}
                sub={result.blocked ? "fix the inputs" : `${result.pieces.toLocaleString("en-IN")} pieces`}
              />
              <StatTile className="px-3 py-1" label="Stops" value={stops || "—"} sub={result.travel ? `travel ${result.travel.toLocaleString("en-IN")} mm` : undefined} />
              <StatTile className="px-3 py-1"
                label="Structure"
                value={inp.shaftWidth && inp.shaftDepth ? `${inp.shaftWidth} × ${inp.shaftDepth}` : "—"}
                sub="outer width × depth"
              />
              <StatTile className="px-3 py-1" label="Counterweight" value={inp.cwt || "—"} tone={inp.cwt ? "primary" : "danger"} />
              {/* Faces come from the built list, so they mean nothing until the inputs are valid. */}
              <StatTile className="px-3 py-1" label="Glass faces" value={(!result.blocked && result.glassFaces.join(" · ")) || "—"} />
              <StatTile className="px-3 py-1"
                label="Cladding faces"
                value={(!result.blocked && shaftCladding.join(" · ")) || "—"}
                sub="+ overhead on all 4 faces"
              />
            </StatStrip>

            <Card>
              <SectionHeader
                title={job ? `Part list — ${job.job_number}` : "Part list — sample sizes"}
                count={result.blocked ? "waiting for valid inputs" : `${needed.length} lines`}
                actions={
                  !result.blocked && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={showNotNeeded}
                        onChange={(e) => setShowNotNeeded(e.target.checked)}
                      />
                      Show parts not needed
                    </label>
                  )
                }
              />
              {result.blocked ? (
                <EmptyState
                  icon={<CircleAlert size={24} />}
                  title="The part list needs complete inputs"
                  description="Fill or correct the inputs marked in red. The list builds itself as soon as they are valid."
                />
              ) : (
                <PartTable lines={result.lines} showNotNeeded={showNotNeeded} />
              )}
            </Card>

          </div>
        </div>
      )}

      {/* ---------------- print-only sheet ---------------- */}
      {active && !result.blocked && (
        <PrintSheet inp={inp} job={job} lines={needed} pieces={result.pieces} status={status} dirty={dirty} />
      )}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #ralph400-print, #ralph400-print * { visibility: visible !important; }
        #ralph400-print { position: absolute; left: 0; top: 0; width: 100%; }
        @page { size: A4; margin: 12mm; }
      }`}</style>
    </div>
  );
}

/* ---------------- pieces ---------------- */

function inputRows(inp: Ralph400Inputs, job: FactoryJobOption | null): [string, string | number][] {
  const rows: [string, string | number][] = [
    ["Job", inp.jobNo || "sample"],
    ["Customer", job?.customer_name ?? ""],
    ["Width (mm)", inp.shaftWidth],
    ["Depth (mm)", inp.shaftDepth],
    ["Pit height (mm)", inp.pitHeight],
    ["Over head (mm)", inp.overHead],
    ["Stops", inp.floors],
  ];
  FLOOR_FIELDS.slice(0, Math.max(0, inp.floors - 1)).forEach(([k, label]) => rows.push([`${label} (mm)`, inp[k]]));
  rows.push(["Counterweight", inp.cwt], ["Door type", inp.doorType], ["Door opening", inp.doorOpening]);
  return rows;
}

function StatusPill({ status, dirty, sample }: { status: Status; dirty: boolean; sample: boolean }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";
  if (sample)
    return <span className={cn(base, "bg-slate-100 text-slate-600")}>Sample sizes — not a job</span>;
  if (status.kind === "loading")
    return <span className={cn(base, "bg-[var(--muted)] text-[var(--muted-foreground)]")}>Loading job…</span>;
  if (status.kind === "saved" && dirty)
    return (
      <span className={cn(base, "bg-amber-50 text-amber-700")}>
        Unsaved changes · last saved {fmtDate(status.savedAt)}
      </span>
    );
  if (status.kind === "saved")
    return (
      <span className={cn(base, "bg-emerald-50 text-emerald-700")}>
        <Check size={12} /> Saved {fmtDate(status.savedAt)}
        {status.savedBy ? ` · ${status.savedBy}` : ""}
      </span>
    );
  if (status.kind === "new")
    return (
      <span className={cn(base, "bg-sky-50 text-sky-700")}>
        Not saved yet — check the inputs, then save
      </span>
    );
  return null;
}

function IssuesCard({ issues }: { issues: InputIssue[] }) {
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  return (
    <Card>
      <div className="space-y-1 px-2 py-1.5 text-xs">
        {errors.map((i, n) => (
          <div key={`e${n}`} className="flex items-start gap-2 text-[var(--destructive)]">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            <span>{i.msg}</span>
          </div>
        ))}
        {warns.map((i, n) => (
          <div key={`w${n}`} className="flex items-start gap-2 text-amber-700">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{i.msg}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const FACE_LETTER: Record<string, string> = { LEFT: "L", RIGHT: "R", BACK: "B", FRONT: "F" };
const whereOf = (l: PartLine) =>
  [l.face ? FACE_LETTER[l.face] ?? l.face : "", l.level === "OVERHEAD" ? "OH" : l.level ?? ""].filter(Boolean).join("-");

function PartTable({ lines, showNotNeeded }: { lines: PartLine[]; showNotNeeded: boolean }) {
  // Numbering follows the needed lines only, so it matches the Excel and print.
  const ordered = SECTIONS.flatMap((s) => lines.filter((l) => l.section === s.key && !l.notNeeded));
  const numberOf = new Map(ordered.map((l, i) => [l.key, i + 1]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
            <th className="w-8 py-1 pl-2 pr-1 font-medium">#</th>
            <th className="py-1 pr-2 font-medium">Code</th>
            <th className="py-1 pr-2 font-medium">Part</th>
            <th className="py-1 pr-2 font-medium" title="Face-level: F front, B back, L left, R right; MOD = 2450 module panel">Where</th>
            <th className="py-1 pr-2 text-right font-medium">Size (mm)</th>
            <th className="py-1 pr-2 text-right font-medium">Qty</th>
            <th className="py-1 pr-2 font-medium">Notes</th>
          </tr>
        </thead>
        {SECTIONS.map((sec) => {
          const rows = lines.filter((l) => l.section === sec.key && (showNotNeeded || !l.notNeeded));
          if (rows.length === 0) return null;
          const count = rows.filter((l) => !l.notNeeded).length;
          return (
            <tbody key={sec.key}>
              <tr className={cn("border-l-4 bg-[var(--muted)]/50", SECTION_BAND[sec.key])}>
                <td colSpan={7} className="px-2 py-0.5" title={sec.blurb}>
                  <span className="font-semibold">{sec.title}</span>
                  <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">
                    {count} {count === 1 ? "line" : "lines"}
                  </span>
                </td>
              </tr>
              {rows.map((l) => (
                <tr
                  key={l.key}
                  className={cn(
                    "border-t border-[var(--border)] align-top",
                    l.notNeeded && "text-[var(--muted-foreground)] opacity-60",
                  )}
                >
                  <td className="py-0.5 pl-2 pr-1 tabular-nums text-[var(--muted-foreground)]">
                    {l.notNeeded ? "" : numberOf.get(l.key)}
                  </td>
                  <td className="whitespace-nowrap py-0.5 pr-2 font-mono text-[11px]" title={l.mark ? `Piece mark: ${l.mark}` : undefined}>
                    {l.code ?? ""}
                  </td>
                  <td className="py-0.5 pr-2">
                    {l.part}
                    {l.drawing && (
                      <span className="ml-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">{l.drawing}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-0.5 pr-2 font-mono text-[11px]">{whereOf(l)}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-right tabular-nums">{l.notNeeded ? "—" : l.size}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-right font-semibold tabular-nums">
                    {l.notNeeded ? <span className="font-normal">not needed</span> : l.qty.toLocaleString("en-IN")}
                  </td>
                  <td className="py-0.5 pr-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1">
                      {l.bracket && (
                        <span className="rounded bg-violet-50 px-1 font-medium text-violet-700">
                          Bracket
                        </span>
                      )}
                      {l.note && <span className="text-[var(--muted-foreground)]">{l.note}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function PrintSheet({
  inp,
  job,
  lines,
  pieces,
  status,
  dirty,
}: {
  inp: Ralph400Inputs;
  job: FactoryJobOption | null;
  lines: PartLine[];
  pieces: number;
  status: Status;
  dirty: boolean;
}) {
  const ordered = SECTIONS.flatMap((s) => lines.filter((l) => l.section === s.key));
  const numberOf = new Map(ordered.map((l, i) => [l.key, i + 1]));
  return (
    <div id="ralph400-print" className="hidden text-[10pt] text-black print:block">
      <div className="mb-2 flex items-end justify-between border-b border-black pb-1">
        <div>
          <div className="text-[14pt] font-bold">RALPH 400 Structure Part List</div>
          <div>
            Job <b>{inp.jobNo || "sample sizes"}</b>
            {job?.customer_name ? ` · ${job.customer_name}` : ""}
            {job?.drive_type ? ` · ${job.drive_type}` : ""}
          </div>
        </div>
        <div className="text-right text-[9pt]">
          {status.kind === "saved" && !dirty
            ? `Saved ${fmtDate(status.savedAt)}${status.savedBy ? ` · ${status.savedBy}` : ""}`
            : "NOT SAVED — draft"}
          <br />
          Printed {fmtDate(new Date().toISOString())}
        </div>
      </div>
      <div className="mb-2 text-[9pt]">
        {inputRows(inp, job)
          .slice(2)
          .map(([k, v]) => (
            <span key={k} className="mr-3 inline-block">
              {k}: <b>{v || "—"}</b>
            </span>
          ))}
      </div>
      <table className="w-full border-collapse text-[9pt]">
        <thead>
          <tr>
            {["#", "Piece mark", "Part", "Size (mm)", "Qty", "Notes"].map((h) => (
              <th key={h} className="border border-black px-1 py-0.5 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {SECTIONS.map((sec) => {
          const ls = lines.filter((l) => l.section === sec.key);
          if (ls.length === 0) return null;
          return (
            <tbody key={sec.key}>
              <tr>
                <td colSpan={6} className="border border-black bg-gray-100 px-1 py-0.5 font-bold">
                  {sec.title}
                </td>
              </tr>
              {ls.map((l) => (
                <tr key={l.key}>
                  <td className="border border-black px-1">{numberOf.get(l.key)}</td>
                  <td className="whitespace-nowrap border border-black px-1 font-mono">{l.mark ?? l.code ?? ""}</td>
                  <td className="border border-black px-1">
                    {l.drawing ? `${l.drawing} ` : ""}
                    {l.part}
                  </td>
                  <td className="border border-black px-1 text-right">{l.size}</td>
                  <td className="border border-black px-1 text-right font-bold">{l.qty}</td>
                  <td className="border border-black px-1">{[l.bracket ? "Bracket" : "", l.note ?? ""].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
      <div className="mt-1 text-right text-[9pt]">
        {lines.length} lines · {pieces.toLocaleString("en-IN")} pieces
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</div>
      {children}
    </div>
  );
}

function Tag({ source }: { source?: Source }) {
  if (!source) return <span className="text-[10px] text-[var(--muted-foreground)]/70">not filled</span>;
  const t = SOURCE_TAG[source];
  return (
    <span title={t.title} className={cn("rounded px-1 py-px text-[10px] font-medium", t.cls)}>
      {t.label}
    </span>
  );
}

interface RowProps {
  label: string;
  k: keyof Ralph400Inputs;
  inp: Ralph400Inputs;
  sources: Sources;
  issue?: InputIssue;
}

function RowLabel({ label, unit, k, sources, issue }: Omit<RowProps, "inp"> & { unit?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs">
      <span
        className={cn(
          "truncate",
          issue?.level === "error" ? "font-medium text-[var(--destructive)]" : "text-[var(--muted-foreground)]",
        )}
      >
        {label}
        {unit ? <span className="text-[10px]"> {unit}</span> : null}
      </span>
      <Tag source={sources[k]} />
    </span>
  );
}

const fieldTone = (issue?: InputIssue) =>
  cn(
    issue?.level === "error" && "border-[var(--destructive-border)] bg-[var(--destructive-bg)]",
    issue?.level === "warn" && "border-amber-300",
  );

function NumRow({
  unit,
  onChange,
  ...p
}: RowProps & { unit?: string; onChange: (k: keyof Ralph400Inputs, raw: string) => void }) {
  const v = p.inp[p.k] as number;
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-1.5" title={p.issue?.msg}>
      <RowLabel label={p.label} unit={unit} k={p.k} sources={p.sources} issue={p.issue} />
      <Input
        size="sm"
        type="number"
        step={1}
        min={0}
        value={v ? v : ""}
        placeholder="—"
        onChange={(e) => onChange(p.k, e.target.value)}
        className={cn("text-right tabular-nums", fieldTone(p.issue))}
      />
    </label>
  );
}

function SelectRow({
  options,
  onChange,
  ...p
}: RowProps & { options: readonly string[]; onChange: (k: keyof Ralph400Inputs, v: string) => void }) {
  const v = String(p.inp[p.k] ?? "");
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-1.5" title={p.issue?.msg}>
      <RowLabel label={p.label} k={p.k} sources={p.sources} issue={p.issue} />
      <Select size="sm" value={v} onChange={(e) => onChange(p.k, e.target.value)} className={fieldTone(p.issue)}>
        <option value="">— pick —</option>
        {v && !options.includes(v) && <option value={v}>{v} (not in list)</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * Searchable job picker: type any part of the job number, customer or drive
 * (multi-word); arrow keys + Enter to pick. Jobs are listed in job-number
 * order. The panel is portalled to <body> so no card can clip it, is wider than
 * the trigger, and opens upward when there is no room below.
 */
function JobPicker({
  jobs,
  value,
  onPick,
}: {
  jobs: FactoryJobOption[];
  value: string;
  onPick: (jobNo: string) => void;
}) {
  const sorted = useMemo(
    () =>
      [...jobs].sort((a, b) =>
        a.job_number.localeCompare(b.job_number, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [jobs],
  );
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (toks.length === 0) return sorted;
    return sorted.filter((j) => {
      const hay = `${j.job_number} ${j.customer_name ?? ""} ${j.drive_type ?? ""}`.toLowerCase();
      return toks.every((t) => hay.includes(t));
    });
  }, [q, sorted]);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 540), vw - 24);
    const left = Math.min(Math.max(12, r.left), vw - width - 12);
    const below = vh - r.bottom - 16;
    const above = r.top - 16;
    if (below >= 280 || below >= above) setPos({ left, width, top: r.bottom + 6, maxH: Math.min(440, below) });
    else setPos({ left, width, bottom: vh - r.top + 6, maxH: Math.min(440, above) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    setQ("");
    const selected = sorted.findIndex((j) => j.job_number === value);
    setHi(selected >= 0 ? selected : 0);
    requestAnimationFrame(() => searchRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [hi, open, pos]);

  const current = jobs.find((j) => j.job_number === value);
  const pick = (jobNo: string) => {
    onPick(jobNo);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const meta = (j: FactoryJobOption) =>
    [j.drive_type, j.floors ? `${j.floors} stops` : null].filter(Boolean).join(" · ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-md border bg-[var(--background)] px-3 py-1.5 text-left transition-colors",
          "border-[var(--border)] hover:border-[var(--border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
          open && "border-[var(--primary)]",
        )}
      >
        <span className="min-w-0 flex-1">
          {current ? (
            <>
              <span className="block font-mono text-sm font-semibold leading-5">{current.job_number}</span>
              <span className="block truncate text-xs leading-4 text-[var(--muted-foreground)]">
                {[current.customer_name, meta(current)].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            <span className="block py-1.5 text-sm text-[var(--muted-foreground)]">Select a job…</span>
          )}
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            className="z-[70] flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
              <Search size={15} className="shrink-0 text-[var(--muted-foreground)]" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHi((h) => Math.min(h + 1, Math.max(matches.length - 1, 0)));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHi((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (matches[hi]) pick(matches[hi].job_number);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
                placeholder="Search job number, customer or drive…"
                className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
              />
              <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
                {matches.length} of {sorted.length}
              </span>
            </div>
            <ul ref={listRef} role="listbox" style={{ maxHeight: Math.max(160, pos.maxH - 50) }} className="overflow-y-auto py-1">
              {matches.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
                  No active RALPH 400 job matches “{q}”
                </li>
              ) : (
                matches.map((j, i) => {
                  const selected = j.job_number === value;
                  return (
                    <li
                      key={j.job_number}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(j.job_number);
                      }}
                      onMouseEnter={() => setHi(i)}
                      className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === hi && "bg-[var(--muted)]")}
                    >
                      <span className="w-28 shrink-0 font-mono text-[13px] font-semibold">{j.job_number}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{j.customer_name || "—"}</span>
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{meta(j)}</span>
                      <Check size={15} className={cn("shrink-0 text-[var(--primary)]", selected ? "opacity-100" : "opacity-0")} />
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
