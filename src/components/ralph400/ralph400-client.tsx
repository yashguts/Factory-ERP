"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Ruler, RotateCcw, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeader } from "@/components/ui/card";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportSheetsToXlsx, type ExportColumn } from "@/lib/export/xlsx";
import { cn } from "@/lib/utils";
import {
  AUDIT,
  DEFAULTS,
  FLOOR_FIELDS,
  LEVELS,
  NA,
  OPTIONS,
  compute,
  validate,
  type Figure,
  type FloorKey,
  type Mode,
  type PanelCell,
  type Ralph400Inputs,
} from "@/lib/ralph400/model";

/* Inputs persist per browser, same as the standalone app did. Not server
   state: nothing on this page reads or writes the database. If the app and
   the sheet ever disagree, read these fields first — a typo survives a
   reload, which has cost a debugging session before. */
const STORE = "ralph400.inputs";

const NUM_KEYS = [
  "shaftWidth",
  "shaftDepth",
  "pitHeight",
  "overHead",
  "floors",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
] as const;

/* ---------------- formatting ---------------- */

function fmt(v: Figure | "GLASS" | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Blank cell: nothing applies here at all. */
function Blank() {
  return <span className="text-[var(--border-strong)]">&mdash;</span>;
}

/** "NO" / "GLASS" — a part that does not apply, rendered as a quiet token. */
function Token({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
      {children}
    </span>
  );
}

function Fig({ value }: { value: Figure | "GLASS" | undefined }) {
  const s = fmt(value);
  if (s === null) return <Blank />;
  if (s === NA || s === "GLASS" || s.trim() === "NO")
    return <Token>{s.trim()}</Token>;
  return <>{s}</>;
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-block rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
      {children}
    </span>
  );
}

/* ---------------- CSV/XLSX export shapes ---------------- */

interface FlatRow {
  [key: string]: string | number;
}

/* ---------------- component ---------------- */

export function Ralph400Client() {
  const [inp, setInp] = useState<Ralph400Inputs>(DEFAULTS);
  const [mode, setMode] = useState<Mode>("sheet");
  // Inputs load from localStorage after mount, never during render: the server
  // and the first client paint must agree or React throws a hydration error.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE);
      if (raw) setInp({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {
      /* private mode / blocked storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify(inp));
    } catch {
      /* ignore */
    }
  }, [inp, hydrated]);

  const m = useMemo(() => compute(inp, mode), [inp, mode]);
  const issues = useMemo(() => validate(inp), [inp]);
  const issueByKey = useMemo(() => {
    const o = {} as Record<FloorKey, (typeof issues)[number] | undefined>;
    issues.forEach((p) => {
      o[p.key] = p;
    });
    return o;
  }, [issues]);

  const setNum = (k: (typeof NUM_KEYS)[number], raw: string) => {
    const n = raw.trim() === "" ? 0 : Number(raw);
    setInp((p) => ({ ...p, [k]: isFinite(n) ? n : 0 }));
  };

  const totalRise = [inp.h1, inp.h2, inp.h3, inp.h4, inp.h5]
    .filter((h) => h > 0)
    .reduce((a, b) => a + b, 0);

  /* ---- export: one workbook, one sheet per table, plus the inputs ---- */
  function exportXlsx() {
    const cellText = (c: PanelCell): string => {
      if (c === null) return "";
      if ("na" in c) return NA;
      return `${fmt(c.h)} x ${c.w === null ? "?" : fmt(c.w)}`;
    };

    const levelHeaders: ExportColumn<FlatRow>[] = LEVELS.map((l) => ({
      header: l,
      field: l,
    }));

    const inputsRows: FlatRow[] = [
      { Field: "Job no", Value: inp.jobNo },
      { Field: "Mode", Value: mode === "sheet" ? "match workbook" : "consistent geometry" },
      { Field: "Shaft W x D", Value: `${inp.shaftWidth} x ${inp.shaftDepth}` },
      { Field: "Pit / Overhead", Value: `${inp.pitHeight} / ${inp.overHead}` },
      { Field: "Floors", Value: inp.floors },
      { Field: "Levels with height", Value: m.liveFloors },
      { Field: "Travel (sum of rises)", Value: totalRise },
      { Field: "Counterweight", Value: inp.cwt },
      { Field: "Door", Value: `${inp.doorType} ${inp.doorOpening}` },
      { Field: "Generated", Value: new Date().toISOString().slice(0, 19).replace("T", " ") },
    ];

    const vertRows: FlatRow[] = m.verticals.map((r) => {
      const row: FlatRow = { Description: r.desc };
      LEVELS.forEach((l, i) => {
        row[l] = fmt(r.cells[i]) ?? "";
      });
      return row;
    });

    const panelRows: FlatRow[] = m.panels.map((r) => {
      const row: FlatRow = { Description: r.desc };
      LEVELS.forEach((l, i) => {
        row[l] = cellText(r.cells[i]);
      });
      return row;
    });

    exportSheetsToXlsx({
      filename: `RALPH400-BOM-${(inp.jobNo || "job").replace(/[^\w-]+/g, "_")}`,
      sheets: [
        {
          name: "Inputs",
          rows: inputsRows,
          columns: [
            { header: "Field", field: "Field" },
            { header: "Value", field: "Value" },
          ],
        },
        {
          name: "Corner verticals",
          rows: vertRows,
          columns: [{ header: "Description", field: "Description" }, ...levelHeaders],
        },
        {
          name: "Glass & sheet panels",
          rows: panelRows,
          columns: [{ header: "Description", field: "Description" }, ...levelHeaders],
        },
        {
          name: "Horizontal channels",
          rows: m.channels.map((r) => ({
            Description: r.desc,
            Bracket: r.br ? r.tag || "BRACKET" : "",
            Qty: fmt(r.qty) ?? "",
            Length: fmt(r.len) ?? "",
          })),
          columns: [
            { header: "Description", field: "Description" },
            { header: "Bracket", field: "Bracket" },
            { header: "Qty", field: "Qty" },
            { header: "Length", field: "Length" },
          ],
        },
        {
          name: "2450 console module",
          rows: m.console2450.map((r) => ({
            Drawing: r.dwg || "",
            Description: r.desc,
            Qty: fmt(r.qty) ?? "",
            Length: fmt(r.len) ?? "",
          })),
          columns: [
            { header: "Drawing", field: "Drawing" },
            { header: "Description", field: "Description" },
            { header: "Qty", field: "Qty" },
            { header: "Length", field: "Length" },
          ],
        },
        {
          name: "Doors & fasteners",
          rows: m.hardware.map((r) => ({
            Description: r.desc,
            Spec: r.tag || "",
            Qty: fmt(r.qty) ?? "",
          })),
          columns: [
            { header: "Description", field: "Description" },
            { header: "Spec", field: "Spec" },
            { header: "Qty", field: "Qty" },
          ],
        },
      ],
    });
  }

  /* ---- shared level-column header ---- */
  const levelHead = LEVELS.map((l, i) => ({ label: l, off: !m.activeLevels[i] }));

  const numCell = "text-right tabular-nums whitespace-nowrap";
  const offCol = "bg-[var(--muted)]/40 text-[var(--muted-foreground)]";

  return (
    <div>
      <PageHeader
        icon={<Ruler size={18} />}
        title="RALPH 400 BOM"
        subtitle="Shaft bill of materials, from Sheet2 of the RALPH 400 workbook."
        className="mb-3"
      />

      {/* Controls sit on their own row rather than in the header's actions
          slot: the mode selector is wide, and sharing a line with the title
          squeezed it to one word per line on a narrow window. */}
      <Toolbar>
        <Select
          size="sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          title="Which formula set to evaluate"
          className="w-auto min-w-[13rem]"
        >
          <option value="sheet">Match workbook</option>
          <option value="clean">Apply consistent geometry</option>
        </Select>
        <span className="text-sm text-[var(--muted-foreground)]">
          {m.liveFloors} of {inp.floors} level{inp.floors === 1 ? "" : "s"} with a height
        </span>
        <ToolbarSpacer />
        <Button type="button" variant="secondary" size="sm" onClick={exportXlsx}>
          <Download size={14} className="mr-1.5" /> Export
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
          <Printer size={14} className="mr-1.5" /> Print
        </Button>
      </Toolbar>

      <div className="grid gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] items-start">
        {/* ---------------- inputs ---------------- */}
        <Card className="lg:sticky lg:top-4">
          <SectionHeader title="Input" />
          <div className="p-3 space-y-3">
            <Field label="Job no">
              <Input
                size="sm"
                value={inp.jobNo}
                onChange={(e) => setInp((p) => ({ ...p, jobNo: e.target.value }))}
              />
            </Field>

            <SubHead>Shaft</SubHead>
            <NumField label="Width external" value={inp.shaftWidth} onChange={(v) => setNum("shaftWidth", v)} />
            <NumField label="Depth external" value={inp.shaftDepth} onChange={(v) => setNum("shaftDepth", v)} />
            <NumField label="Pit height" value={inp.pitHeight} onChange={(v) => setNum("pitHeight", v)} />
            <NumField label="Over head" value={inp.overHead} onChange={(v) => setNum("overHead", v)} />

            <SubHead>Floors</SubHead>
            <NumField label="No of floors" value={inp.floors} min={1} onChange={(v) => setNum("floors", v)} />
            {FLOOR_FIELDS.map(([key, label]) => {
              const issue = issueByKey[key];
              const unused = !(inp[key] > 0);
              return (
                <NumField
                  key={key}
                  label={label}
                  value={inp[key]}
                  dim={unused}
                  bad={!!issue}
                  title={issue?.msg}
                  onChange={(v) => setNum(key, v)}
                />
              );
            })}

            <SubHead>Configuration</SubHead>
            <Field label="Counterweight">
              <Select
                size="sm"
                value={inp.cwt}
                onChange={(e) => setInp((p) => ({ ...p, cwt: e.target.value }))}
              >
                {OPTIONS.cwt.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label="Door type">
              <Select
                size="sm"
                value={inp.doorType}
                onChange={(e) => setInp((p) => ({ ...p, doorType: e.target.value }))}
              >
                {OPTIONS.doorType.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label="Door opening">
              <Select
                size="sm"
                value={inp.doorOpening}
                onChange={(e) => setInp((p) => ({ ...p, doorOpening: e.target.value }))}
              >
                {OPTIONS.doorOpening.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>

            {issues.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {issues.map((p) => (
                  <div
                    key={p.key}
                    className="rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-bg)] px-2.5 py-1.5 text-xs text-[var(--destructive)]"
                  >
                    <b>{p.label}</b> {p.msg}
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setInp(DEFAULTS)}
            >
              <RotateCcw size={14} className="mr-1.5" /> Reset to {DEFAULTS.jobNo}
            </Button>
          </div>
        </Card>

        {/* ---------------- output ---------------- */}
        <div className="space-y-3 min-w-0">
          <StatStrip>
            <StatTile label="Job" value={inp.jobNo || "—"} />
            <StatTile label="Shaft W × D" value={`${inp.shaftWidth} × ${inp.shaftDepth}`} />
            <StatTile label="Floors" value={inp.floors} />
            <StatTile
              label="Levels with height"
              value={m.liveFloors}
              tone={m.liveFloors === 0 ? "danger" : "default"}
            />
            <StatTile label="Travel" value={totalRise} sub="sum of rises" />
            <StatTile label="Counterweight" value={inp.cwt} tone="primary" />
            <StatTile label="Door" value={`${inp.doorType} · ${inp.doorOpening}`} />
          </StatStrip>

          {/* corner verticals */}
          <Card>
            <SectionHeader title="Corner verticals — extension length" count="4 posts per level · mm" />
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  {levelHead.map((h) => (
                    <TableHead key={h.label} className={cn(numCell, h.off && offCol)}>
                      {h.label}
                    </TableHead>
                  ))}
                  <TableHead className={numCell}>Qty / level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.verticals.map((r) => (
                  <TableRow key={r.desc}>
                    <TableCell className="font-medium whitespace-nowrap">{r.desc}</TableCell>
                    {r.cells.map((c, i) => (
                      <TableCell key={i} className={cn(numCell, levelHead[i].off && offCol)}>
                        <Fig value={c} />
                      </TableCell>
                    ))}
                    {/* Hardcoded, as in the source app — see VerticalRow.qty. */}
                    <TableCell className={numCell}>1</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* panels */}
          <Card>
            <SectionHeader title="Glass & sheet panels — height × width" count="mm" />
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  {levelHead.map((h) => (
                    <TableHead key={h.label} className={cn(numCell, h.off && offCol)}>
                      {h.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.panels.map((r) => (
                  <TableRow key={r.desc}>
                    <TableCell className="font-medium whitespace-nowrap">{r.desc}</TableCell>
                    {r.cells.map((c, i) => (
                      <TableCell key={i} className={cn(numCell, levelHead[i].off && offCol)}>
                        <PanelFigure cell={c} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* channels */}
          <Card>
            <SectionHeader title="Horizontal channels" />
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Bracket</TableHead>
                  <TableHead className={numCell}>Qty</TableHead>
                  <TableHead className={numCell}>Length</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.channels.map((r) => (
                  <TableRow key={r.desc}>
                    <TableCell className="font-medium whitespace-nowrap">{r.desc}</TableCell>
                    <TableCell>{r.br ? <Tag>{r.tag || "BRACKET"}</Tag> : null}</TableCell>
                    <TableCell className={numCell}>
                      <Fig value={r.qty} />
                    </TableCell>
                    <TableCell className={numCell}>
                      <Fig value={r.len} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* 2450 console */}
          <Card>
            <SectionHeader title="2450 console module" count="fixed module, repeated per floor" />
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Drawing</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className={numCell}>Qty</TableHead>
                  <TableHead className={numCell}>Length</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.console2450.map((r) => (
                  <TableRow key={r.desc}>
                    <TableCell className="font-mono text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                      {r.dwg || ""}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{r.desc}</TableCell>
                    <TableCell className={numCell}>
                      <Fig value={r.qty} />
                    </TableCell>
                    <TableCell className={numCell}>
                      <Fig value={r.len} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* hardware */}
          <Card>
            <SectionHeader title="Doors, brackets & fasteners" />
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead className={numCell}>Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.hardware.map((r) => (
                  <TableRow key={r.desc}>
                    <TableCell className="font-medium whitespace-nowrap">{r.desc}</TableCell>
                    <TableCell>{r.tag ? <Tag>{r.tag}</Tag> : null}</TableCell>
                    <TableCell className={numCell}>
                      <Fig value={r.qty} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* audit */}
          <Card>
            <SectionHeader
              title="Source audit"
              count="cells where the workbook disagrees with its own rule"
            />
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Cell</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Workbook</TableHead>
                  <TableHead>Consistent</TableHead>
                  <TableHead>Why it looks wrong</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AUDIT.map((a) => (
                  <TableRow key={a.cell}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{a.cell}</TableCell>
                    <TableCell className="whitespace-nowrap">{a.what}</TableCell>
                    <TableCell className="font-mono text-xs">{a.sheet}</TableCell>
                    <TableCell className="font-mono text-xs">{a.clean}</TableCell>
                    <TableCell className="text-[var(--muted-foreground)]">{a.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
              {mode === "sheet" ? (
                <>
                  Showing <b className="text-[var(--foreground)]">workbook values</b> — the tables
                  above reproduce the spreadsheet exactly, drift included. Switch the selector to{" "}
                  <span className="font-mono">Apply consistent geometry</span> to see what changes.
                </>
              ) : (
                <>
                  Showing <b className="text-[var(--foreground)]">corrected values</b> — the six
                  cells above use their consistent value. This does <em>not</em> modify the .xlsx
                  file.
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------------- small local pieces ---------------- */

function PanelFigure({ cell }: { cell: PanelCell }) {
  if (cell === null) return <Blank />;
  if ("na" in cell) return <Token>{NA}</Token>;
  return (
    <span className="whitespace-nowrap">
      <b>{fmt(cell.h)}</b>
      <i className="not-italic mx-1 text-[var(--muted-foreground)]">×</i>
      {cell.w === null ? <Blank /> : <b>{fmt(cell.w)}</b>}
    </span>
  );
}

function SubHead({ children }: { children: string }) {
  return (
    <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  dim,
  bad,
  title,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  min?: number;
  /** Level is simply not used — fade it rather than flagging it. */
  dim?: boolean;
  /** Level is below its minimum usable height — it carries no parts. */
  bad?: boolean;
  title?: string;
}) {
  return (
    <label
      className={cn(
        "grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2",
        dim && !bad && "opacity-55",
      )}
      title={title}
    >
      <span
        className={cn(
          "text-sm",
          bad ? "text-[var(--destructive)] font-medium" : "text-[var(--muted-foreground)]",
        )}
      >
        {label}
      </span>
      <Input
        size="sm"
        type="number"
        step={1}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "text-right tabular-nums",
          bad && "border-[var(--destructive-border)] bg-[var(--destructive-bg)]",
        )}
      />
    </label>
  );
}
