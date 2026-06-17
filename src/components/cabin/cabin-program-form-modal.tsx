"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Search, X, Plus, Trash2, Loader2, Check } from "lucide-react";
import { cn, formatDuration, parseDuration } from "@/lib/utils";
import {
  createCabinProgram,
  updateCabinProgram,
  searchSheetItems,
  searchCabinProgramOutputs,
  type CabinProgramDetail,
  type SheetSearchItem,
  type OutputSearchItem,
} from "@/lib/actions/cabin-programs";
import {
  CABIN_PROGRAM_CATEGORIES,
  CABIN_PROGRAM_FINISHES,
  CABIN_PROGRAM_MACHINES,
  type CabinProgramCategory,
} from "@/lib/cabin/cabin-program-meta";

const MACHINE_LABEL: Record<string, string> = {
  cnc_laser: "Laser cutting",
  cnc_punch: "Punching",
  assembly_fit: "Assembly / fit",
};

interface OutputRow {
  key: string;
  item_id: string | null;
  code: string | null;
  name: string;
  family: string | null;
  cabin_type: string | null;
  qty: string;
}

let keySeq = 0;
const newKey = () => `o${keySeq++}`;
const emptyOutput = (): OutputRow => ({ key: newKey(), item_id: null, code: null, name: "", family: null, cabin_type: null, qty: "1" });

export function CabinProgramFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: CabinProgramDetail | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const editing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [category, setCategory] = useState<CabinProgramCategory>(initial?.category ?? "Cabin");
  const [machine, setMachine] = useState(initial?.machine ?? "cnc_laser");
  const [sheet, setSheet] = useState<{ id: string; name: string } | null>(
    initial?.input_sheet_item_id ? { id: initial.input_sheet_item_id, name: initial.input_sheet_name ?? "" } : null,
  );
  const [sheetsPerRun, setSheetsPerRun] = useState(String(initial?.sheets_per_run ?? 1));
  const [machiningTime, setMachiningTime] = useState(
    initial?.machining_time_seconds ? formatDuration(initial.machining_time_seconds) : "",
  );
  const [scrapPercent, setScrapPercent] = useState(
    initial?.scrap_percent != null ? String(initial.scrap_percent) : "",
  );
  const [outputs, setOutputs] = useState<OutputRow[]>(
    initial?.outputs.length
      ? initial.outputs.map((o) => ({
          key: newKey(),
          item_id: o.item_id,
          code: o.code,
          name: o.name ?? "",
          family: o.family,
          cabin_type: o.cabin_type,
          qty: String(o.qty_per_run),
        }))
      : [emptyOutput()],
  );
  const [finishes, setFinishes] = useState<Set<string>>(new Set(initial?.finishes ?? []));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const toggleFinish = (f: string) =>
    setFinishes((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const setOutput = (key: string, patch: Partial<OutputRow>) =>
    setOutputs((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!name.trim()) return toast.error("Program name is required.");
    if (finishes.size === 0) return toast.error("Pick at least one finish.");
    const cleanOut = outputs.filter((o) => o.item_id && Number(o.qty) > 0);
    if (cleanOut.length === 0) return toast.error("Add at least one output.");

    const machiningSeconds = parseDuration(machiningTime);
    if (machiningSeconds === undefined) {
      return toast.error('Machining time must be "h:mm:ss", "mm:ss" or decimal minutes (e.g. 7:03 or 7.05).');
    }
    const scrapTrim = scrapPercent.trim();
    const scrapValue = scrapTrim === "" ? null : Number(scrapTrim);
    if (scrapValue != null && (!Number.isFinite(scrapValue) || scrapValue < 0 || scrapValue > 100)) {
      return toast.error("Scrap % must be a number between 0 and 100.");
    }

    setSaving(true);
    const input = {
      name: name.trim(),
      code: code.trim() || null,
      category,
      machine: machine || null,
      input_sheet_item_id: sheet?.id ?? null,
      sheets_per_run: Number(sheetsPerRun) || 1,
      machining_time_seconds: machiningSeconds,
      scrap_percent: scrapValue,
      description: description.trim() || null,
      notes: notes.trim() || null,
      finishes: [...finishes],
      outputs: cleanOut.map((o) => ({
        item_id: o.item_id,
        family: o.family,
        cabin_type: o.cabin_type,
        label: o.name,
        qty_per_run: Number(o.qty),
      })),
    };
    const res = editing ? await updateCabinProgram(initial!.id, input) : await createCabinProgram(input);
    setSaving(false);
    if (res.ok) {
      toast.success(editing ? "Program updated" : "Program created");
      onSaved(res.id);
    } else {
      toast.error(res.error);
    }
  };

  return (
    <Modal title={editing ? "Edit cabin program" : "New cabin program"} onClose={onClose} size="xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Name + code */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-[var(--muted-foreground)]">Program name</label>
            <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. P1C 500 side-panel nest" />
          </div>
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">Code <span className="opacity-60">· auto if blank</span></label>
            <Input size="sm" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CAB-…" className="font-mono" />
          </div>
        </div>

        {/* Category + machine */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Program category</label>
            <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-sm">
              {CABIN_PROGRAM_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "px-3 py-1.5 cursor-pointer border-l first:border-l-0 border-[var(--border)] transition-colors",
                    category === c ? "bg-[var(--primary)]/10 text-[var(--primary)] font-medium" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Machine</label>
            <Select size="sm" value={machine} onChange={(e) => setMachine(e.target.value)} className="w-[150px]">
              {CABIN_PROGRAM_MACHINES.map((m) => (
                <option key={m} value={m}>{MACHINE_LABEL[m] ?? m}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Sheet input */}
        <div className="rounded-md border border-[var(--border)] p-3 bg-[var(--muted)]/30">
          <label className="text-xs text-[var(--muted-foreground)] block mb-1.5">Cut from — sheet / plate (raw material)</label>
          {sheet ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">{sheet.name}</span>
              <span className="text-xs text-[var(--muted-foreground)]">×</span>
              <Input size="sm" type="number" min="0.1" step="0.1" value={sheetsPerRun} onChange={(e) => setSheetsPerRun(e.target.value)} className="w-20" />
              <span className="text-xs text-[var(--muted-foreground)]">/ run</span>
              <button type="button" onClick={() => setSheet(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer" aria-label="Clear sheet">
                <X size={15} />
              </button>
            </div>
          ) : (
            <SheetSearch onPick={(s) => setSheet({ id: s.id, name: s.name })} />
          )}
          <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">The actual sheet is chosen per finish at plan time — this just fixes the thickness &amp; size.</p>
        </div>

        {/* Machining time + scrap — read off the uploaded nesting-report PDF */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">
              Machining time / run <span className="opacity-60">· h:mm:ss or min</span>
            </label>
            <Input
              size="sm"
              value={machiningTime}
              onChange={(e) => setMachiningTime(e.target.value)}
              placeholder="e.g. 0:07:03 or 7.05"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">
              Scrap <span className="opacity-60">· % of sheet wasted</span>
            </label>
            <Input
              size="sm"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={scrapPercent}
              onChange={(e) => setScrapPercent(e.target.value)}
              placeholder="e.g. 18"
            />
          </div>
        </div>

        {/* Outputs */}
        <div>
          <label className="text-xs text-[var(--muted-foreground)] block mb-1.5">Produces — search Inventory + Cabin Inventory</label>
          <div className="space-y-2">
            {outputs.map((row) => (
              <div key={row.key} className="flex items-start gap-2">
                <div className="flex-1">
                  {row.item_id ? (
                    <div className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5">
                      <span className="text-sm flex-1">
                        <span className="font-medium">{row.family ?? row.name}</span>
                        {row.family && <span className="ml-1.5 text-[11px] text-[var(--muted-foreground)]">{row.cabin_type ?? "family"} · finish-varying</span>}
                        {!row.family && row.code && <span className="ml-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">{row.code}</span>}
                      </span>
                      <button type="button" onClick={() => setOutput(row.key, { item_id: null, code: null, name: "", family: null, cabin_type: null })} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer" aria-label="Clear output">
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <OutputSearch
                      onPick={(it) =>
                        setOutput(row.key, {
                          item_id: it.id,
                          code: it.code,
                          name: it.name,
                          family: it.family,
                          cabin_type: it.family ? it.category : null,
                        })
                      }
                    />
                  )}
                </div>
                <Input size="sm" type="number" min="0.1" step="0.1" value={row.qty} onChange={(e) => setOutput(row.key, { qty: e.target.value })} className="w-20" title="Qty per run" />
                <button
                  type="button"
                  onClick={() => setOutputs((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : [emptyOutput()]))}
                  className="mt-1.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)] cursor-pointer"
                  aria-label="Remove output"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOutputs((p) => [...p, emptyOutput()])}>
            <Plus size={14} className="mr-1" /> Add output
          </Button>
        </div>

        {/* Finishes */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-[var(--muted-foreground)]">Cut in these finishes</label>
            <span className="text-[11px] text-[var(--muted-foreground)]">{finishes.size} selected</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CABIN_PROGRAM_FINISHES.map((f) => {
              const on = finishes.has(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFinish(f)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors inline-flex items-center gap-1",
                    on ? "bg-[var(--primary)]/10 text-[var(--primary)] font-medium" : "border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
                  )}
                >
                  {f}
                  {on && <Check size={11} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Description / notes */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">Description</label>
            <Input size="sm" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">Notes</label>
            <Input size="sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[var(--border)]">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 size={15} className="mr-1.5 animate-spin" /> Saving…</> : editing ? "Save changes" : "Create program"}
        </Button>
      </div>
    </Modal>
  );
}

/* ---- async search dropdowns ---- */

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SheetSearch({ onPick }: { onPick: (s: SheetSearchItem) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [results, setResults] = useState<SheetSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (dq.trim().length < 1) { setResults([]); return; }
    const my = ++seq.current;
    setLoading(true);
    searchSheetItems(dq).then((r) => { if (my === seq.current) { setResults(r); setLoading(false); } }).catch(() => setLoading(false));
  }, [dq]);

  return (
    <div className="relative">
      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
      <Input size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sheet / plate…" className="pl-8" />
      {q.trim() && (results.length > 0 || loading) && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)]">
          {loading && <div className="px-3 py-2 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="inline animate-spin mr-1" /> Searching…</div>}
          {results.map((s) => (
            <button key={s.id} type="button" onClick={() => { onPick(s); setQ(""); }} className="w-full text-left px-3 py-1.5 hover:bg-[var(--muted)] cursor-pointer flex items-center gap-2">
              <span className="text-sm flex-1 truncate">{s.name}</span>
              {s.thickness_mm != null && <span className="text-[11px] text-[var(--primary)]">{s.thickness_mm}mm</span>}
              <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{s.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputSearch({ onPick }: { onPick: (it: OutputSearchItem) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [results, setResults] = useState<OutputSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const run = useCallback(() => {
    if (dq.trim().length < 1) { setResults([]); return; }
    const my = ++seq.current;
    setLoading(true);
    searchCabinProgramOutputs(dq).then((r) => { if (my === seq.current) { setResults(r); setLoading(false); } }).catch(() => setLoading(false));
  }, [dq]);
  useEffect(run, [run]);

  return (
    <div className="relative">
      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
      <Input size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any inventory or cabin item…" className="pl-8" />
      {q.trim() && (results.length > 0 || loading) && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)]">
          {loading && <div className="px-3 py-2 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="inline animate-spin mr-1" /> Searching…</div>}
          {results.map((it) => (
            <button key={it.id} type="button" onClick={() => { onPick(it); setQ(""); }} className="w-full text-left px-3 py-1.5 hover:bg-[var(--muted)] cursor-pointer">
              <div className="flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{it.family ?? it.name}</span>
                <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{it.code}</span>
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                {it.family ? <span className="text-[var(--primary)]">finish-varying · {it.category}</span> : (it.category ?? it.item_type)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
