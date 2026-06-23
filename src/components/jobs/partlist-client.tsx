"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Check, Search, X, Loader2, AlertTriangle, Sparkles, ChevronDown, ChevronRight,
  Plus, CircleCheck, ShieldCheck, PackageCheck, Pencil, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { PACKING_SECTIONS, type PackingSection } from "@/lib/packing-list/packing-list-sections";
import { OTHER_SECTION_KEY } from "@/lib/packing-list/helpers";
import groupsJson from "@/lib/partlist/section-groups.json";
import type { SearchableItem } from "@/lib/actions/items";
import {
  savePartList, savePartListSection, markPartListReady, reopenPartList, getPartList, searchPartItems,
  type PartListView, type SaveLineInput,
} from "@/lib/actions/partlist";
import { generatePartListDraft } from "@/lib/actions/partlist-generate";
import { ensureDrawingRead } from "@/lib/actions/spec-vision";

const GROUPS = groupsJson as Record<string, string>;
// Group order = the order groups first appear in the curated section list, plus the
// BOM "Unsorted" group at the end.
const GROUP_ORDER = (() => {
  const seen: string[] = [];
  for (const g of Object.values(GROUPS)) if (!seen.includes(g)) seen.push(g);
  if (!seen.includes("OTHER")) seen.push("OTHER");
  return seen;
})();
const GROUP_LABELS: Record<string, string> = { OTHER: "Unsorted (from BOM) — please file" };
const glabel = (g: string): string => GROUP_LABELS[g] ?? g;

interface Row {
  uid: string;
  item_id: string | null;
  code: string | null;
  name: string | null; // item name OR free-text label
  uom: string | null;
  spec: string | null;
  qty: number;
  source: string | null;
  confidence: string | null;
  is_conflict: boolean;
  conflict_note: string | null;
  not_required: boolean;
  non_inventory: boolean;
  bom_line_id: string | null;
  dismissed_reason: string | null;
  checked: boolean;
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `r${Math.random().toString(36).slice(2)}`);
const sectionGroup = (key: string) => GROUPS[key] || "PART E";

const SECTION_BY_KEY = new Map(PACKING_SECTIONS.map((s) => [s.key, s]));

// A section applies to the universe view when its DRIVE gate passes for this job
// (door gates are resolved at generate time from the drawing, so door-gated lines
// stay visible/greyed here regardless).
function driveApplies(s: PackingSection, drive: string | null): boolean {
  if (!s.drives || !s.drives.length) return true;
  return !!drive && s.drives.includes(drive.toUpperCase());
}

function rowsFromView(view: PartListView): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const [sk, lines] of Object.entries(view.linesBySection)) {
    out[sk] = lines.map((l) => ({
      uid: uid(), item_id: l.item_id, code: l.code, name: l.name, uom: l.uom, spec: l.spec,
      qty: l.qty, source: l.source, confidence: l.confidence, is_conflict: l.is_conflict,
      conflict_note: null, not_required: l.not_required, non_inventory: l.non_inventory, bom_line_id: l.bom_line_id,
      dismissed_reason: l.dismissed_reason, checked: l.checked,
    }));
  }
  return out;
}

interface Props {
  jobId: string;
  jobNumber: string;
  customerName: string | null;
  driveType: string | null;
  initial: PartListView;
}

export function PartListClient({ jobId, jobNumber, customerName, driveType, initial }: Props) {
  const toast = useToast();
  // Curated template sections per group, drive-gated for this job (e.g. R1000-only
  // lines hidden on a non-R1000 job). Door gates are applied at generate time.
  const templateByGroup = useMemo<Record<string, PackingSection[]>>(() => {
    const m: Record<string, PackingSection[]> = {};
    for (const g of GROUP_ORDER) m[g] = [];
    for (const s of PACKING_SECTIONS) {
      if (!driveApplies(s, driveType)) continue;
      (m[sectionGroup(s.key)] ||= []).push(s);
    }
    return m;
  }, [driveType]);
  const [rows, setRows] = useState<Record<string, Row[]>>(() => rowsFromView(initial));
  const [dispositions, setDispositions] = useState<Record<string, string>>(initial.sectionDispositions || {});
  const [status, setStatus] = useState<"draft" | "ready">(initial.status);
  const [coverage, setCoverage] = useState(initial.coverage);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showGreyed, setShowGreyed] = useState<Set<string>>(new Set(GROUP_ORDER)); // greyed visible by default
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<null | "generate" | "save" | "ready" | "read">(null);
  const [confirmGen, setConfirmGen] = useState(false);
  const lastWarnings = useRef<string[]>(initial ? [] : []);

  const hasAnyRows = useMemo(() => Object.values(rows).some((a) => a.length), [rows]);

  /* --------------------------- derived: gate --------------------------- */
  const allRows = useMemo(() => Object.values(rows).flat(), [rows]);
  const activeRows = useMemo(() => allRows.filter((r) => !r.not_required && (r.item_id || (r.name && r.name.trim()))), [allRows]);
  const uncheckedActive = activeRows.filter((r) => !r.checked).length;
  // item-type lines with no inventory item linked (free-text fastener lines exempt)
  const needsItemCount = useMemo(() => {
    let n = 0;
    for (const [sk, arr] of Object.entries(rows)) {
      const ct = sk === OTHER_SECTION_KEY ? "item" : (SECTION_BY_KEY.get(sk)?.captureType ?? "item");
      if (ct === "free") continue;
      for (const r of arr) if (!r.not_required && !r.item_id && !r.non_inventory) n++;
    }
    return n;
  }, [rows]);
  const groupsPresent = GROUP_ORDER.filter((g) => (templateByGroup[g]?.length || 0) > 0 || (g === "OTHER" && (rows[OTHER_SECTION_KEY]?.length || 0) > 0));
  const undisposed = groupsPresent.filter((g) => !dispositions[g]);
  const coverageOk = coverage.total === 0 || coverage.covered >= coverage.total;
  const canMarkReady = uncheckedActive === 0 && undisposed.length === 0 && coverageOk && needsItemCount === 0 && hasAnyRows;

  /* --------------------------- mutations --------------------------- */
  const patchRow = useCallback((sk: string, ruid: string, patch: Partial<Row>) => {
    setRows((prev) => ({ ...prev, [sk]: (prev[sk] || []).map((r) => (r.uid === ruid ? { ...r, ...patch } : r)) }));
    setStatus("draft");
  }, []);
  const addRow = useCallback((sk: string) => {
    const r: Row = { uid: uid(), item_id: null, code: null, name: null, uom: null, spec: null, qty: 1, source: "manual", confidence: null, is_conflict: false, conflict_note: null, not_required: false, non_inventory: false, bom_line_id: null, dismissed_reason: null, checked: false };
    setRows((prev) => ({ ...prev, [sk]: [...(prev[sk] || []), r] }));
    setStatus("draft");
    setDispositions((d) => { const g = sk === OTHER_SECTION_KEY ? "OTHER" : sectionGroup(sk); if (!d[g]) return d; const { [g]: _x, ...rest } = d; return rest; });
  }, []);
  const removeRow = useCallback((sk: string, r: Row) => {
    if (r.bom_line_id) {
      const reason = window.prompt("This line is from the BOM. Give a reason to dismiss it (it will be recorded as intentionally not packed):", r.dismissed_reason || "");
      if (reason == null) return;
      patchRow(sk, r.uid, { not_required: true, dismissed_reason: reason || "dismissed", checked: true });
      return;
    }
    setRows((prev) => ({ ...prev, [sk]: (prev[sk] || []).filter((x) => x.uid !== r.uid) }));
    setStatus("draft");
  }, [patchRow]);
  const toggleCheck = useCallback((sk: string, r: Row) => {
    if (!r.not_required && !r.non_inventory && !r.item_id && !(r.name && r.name.trim())) { toast.error("Add an item, mark it non-stock, or type text before confirming this line."); return; }
    patchRow(sk, r.uid, { checked: !r.checked });
  }, [patchRow, toast]);

  const confirmGroup = useCallback((g: string) => {
    const keys = g === "OTHER" ? [OTHER_SECTION_KEY] : (templateByGroup[g] || []).map((s) => s.key);
    const unconfirmed = keys.flatMap((k) => rows[k] || []).filter((r) => !r.not_required && (r.item_id || (r.name && r.name.trim())) && !r.checked);
    if (unconfirmed.length) { toast.error(`${unconfirmed.length} line(s) in this section still need a ✓ before you can confirm it.`); return; }
    const needs = keys.flatMap((k) => rows[k] || []).filter((r) => !r.not_required && !r.item_id && !(r.name && r.name.trim()));
    if (needs.length) { toast.error(`${needs.length} line(s) here still need an item.`); return; }
    setDispositions((d) => ({ ...d, [g]: "confirmed" }));
    toast.success(`${glabel(g).split(" — ")[0]} confirmed.`);
  }, [rows, toast]);

  /* --------------------------- generate / save / ready --------------------------- */
  const applyDraft = useCallback((draft: Awaited<ReturnType<typeof generatePartListDraft>>) => {
    const next: Record<string, Row[]> = {};
    for (const l of draft.lines) {
      const r: Row = {
        uid: uid(), item_id: l.item_id, code: l.item_code, name: l.captureType === "free" ? (l.spec ?? null) : l.item_name,
        uom: null, spec: l.spec, qty: l.qty, source: l.source, confidence: l.confidence, is_conflict: l.is_conflict,
        conflict_note: l.conflict_note, not_required: false, non_inventory: l.non_inventory, bom_line_id: l.bom_line_id, dismissed_reason: null, checked: false,
      };
      (next[l.sectionKey] ||= []).push(r);
    }
    setRows(next);
    setDispositions({});
    setStatus("draft");
    setCoverage(draft.coverage);
    lastWarnings.current = draft.warnings;
  }, []);

  const runGenerate = useCallback(async () => {
    setConfirmGen(false);
    setBusy("generate");
    try {
      const draft = await generatePartListDraft(jobId);
      applyDraft(draft);
      const drew = draft.drawingRead ? "read the drawing" : "used spec + BOM";
      toast.success(`Generated — ${drew}. ${draft.lines.length} lines, ${draft.coverage.covered}/${draft.coverage.total} BOM items placed.`);
      draft.warnings.forEach((w) => toast.info(w));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally { setBusy(null); }
  }, [jobId, applyDraft, toast]);

  const buildSaveInput = useCallback((): SaveLineInput[] => {
    const out: SaveLineInput[] = [];
    for (const [sk, arr] of Object.entries(rows)) {
      const sec = SECTION_BY_KEY.get(sk);
      const isFree = sec?.captureType === "free";
      for (const r of arr) {
        out.push({
          sectionKey: sk,
          item_id: isFree ? null : r.item_id,
          label: isFree ? r.name : (r.item_id ? null : r.name),
          spec: r.spec, qty: r.qty, source: r.source, confidence: r.confidence,
          is_conflict: r.is_conflict, checked: r.checked, not_required: r.not_required,
          bom_line_id: r.bom_line_id, dismissed_reason: r.dismissed_reason,
        });
      }
    }
    return out;
  }, [rows]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const res = await savePartList(jobId, { lines: buildSaveInput(), sectionDispositions: dispositions });
    if (!res.ok) { toast.error(res.error); return false; }
    // refresh coverage from the saved source of truth
    const view = await getPartList(jobId);
    setCoverage(view.coverage);
    return true;
  }, [jobId, buildSaveInput, dispositions, toast]);

  const onSave = useCallback(async () => {
    setBusy("save");
    try { if (await doSave()) toast.success("Saved."); } finally { setBusy(null); }
  }, [doSave, toast]);

  const onSaveSection = useCallback(async (g: string) => {
    const keys = g === "OTHER" ? [OTHER_SECTION_KEY] : (templateByGroup[g] || []).map((s) => s.key);
    const lines: SaveLineInput[] = [];
    for (const sk of keys) {
      const isFree = SECTION_BY_KEY.get(sk)?.captureType === "free";
      for (const r of rows[sk] || []) {
        lines.push({ sectionKey: sk, item_id: isFree ? null : r.item_id, label: isFree ? r.name : (r.item_id ? null : r.name), spec: r.spec, qty: r.qty, source: r.source, confidence: r.confidence, is_conflict: r.is_conflict, checked: r.checked, not_required: r.not_required, non_inventory: r.non_inventory, bom_line_id: r.bom_line_id, dismissed_reason: r.dismissed_reason });
      }
    }
    setBusy("save");
    try {
      const res = await savePartListSection(jobId, keys, lines, dispositions[g] ? { group: g, value: dispositions[g] } : undefined);
      if (!res.ok) { toast.error(res.error); return; }
      const view = await getPartList(jobId); setCoverage(view.coverage);
      toast.success(`${glabel(g).split(" — ")[0]} saved.`);
    } finally { setBusy(null); }
  }, [rows, dispositions, jobId, toast]);

  const onMarkReady = useCallback(async () => {
    setBusy("ready");
    try {
      if (!(await doSave())) return;
      const res = await markPartListReady(jobId);
      if (res.ok) { setStatus("ready"); toast.success("Part List marked READY ✓"); }
      else {
        const b = res.blockers;
        const parts: string[] = [];
        if (b?.needsItem) parts.push(`${b.needsItem} line(s) need an inventory item`);
        if (b?.uncheckedActive) parts.push(`${b.uncheckedActive} line(s) unconfirmed`);
        if (b?.uncoveredBom) parts.push(`${b.uncoveredBom} BOM item(s) missing`);
        if (b?.undispositionedGroups?.length) parts.push(`confirm: ${b.undispositionedGroups.join(", ")}`);
        toast.error(`Not ready — ${parts.join(" · ") || res.error}`);
      }
    } finally { setBusy(null); }
  }, [jobId, doSave, toast]);

  const onReopen = useCallback(async () => { await reopenPartList(jobId); setStatus("draft"); toast.info("Re-opened for edits."); }, [jobId, toast]);

  const onReadDrawing = useCallback(async () => {
    setBusy("read");
    try {
      const r = await ensureDrawingRead(jobId);
      if (r.ok && r.cached) toast.info("Drawing already read — Generate will use it.");
      else if (r.ok) toast.success("Drawing read ✓ — click Generate (or Regenerate) to use it.");
      else if (r.reason === "no-drawing") toast.error("No drawing uploaded on this job.");
      else if (r.reason === "not_configured") toast.error("Drawing reader not configured (ANTHROPIC_API_KEY).");
      else toast.error("Couldn't read the drawing — try again.");
    } catch { toast.error("Couldn't read the drawing — try again."); }
    finally { setBusy(null); }
  }, [jobId, toast]);

  /* --------------------------- render --------------------------- */
  const matchFilter = (s: PackingSection) => !filter || s.label.toLowerCase().includes(filter.toLowerCase());

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      {/* header */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold text-[var(--foreground)]">
              <PackageCheck className="h-4 w-4 text-[var(--primary)]" />
              Part List — {jobNumber}
              <StatusBadge status={status} />
            </h1>
            {customerName && <p className="truncate text-xs text-[var(--muted-foreground)]">{customerName}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onReadDrawing} disabled={!!busy} title="Read this job's drawing and cache it for Generate">
              {busy === "read" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Read drawing
            </Button>
            <Button variant="secondary" size="sm" onClick={() => (hasAnyRows ? setConfirmGen(true) : runGenerate())} disabled={!!busy}>
              {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {hasAnyRows ? "Regenerate" : "Generate Part List"}
            </Button>
            <Button variant="secondary" size="sm" onClick={onSave} disabled={!!busy || !hasAnyRows}>
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
            {status === "ready" ? (
              <Button variant="secondary" size="sm" onClick={onReopen} disabled={!!busy}><Pencil className="h-3.5 w-3.5" /> Re-open</Button>
            ) : (
              <Button size="sm" onClick={onMarkReady} disabled={!!busy || !canMarkReady} title={canMarkReady ? "" : "Confirm every line + section and place all BOM items first"}>
                {busy === "ready" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Mark Ready
              </Button>
            )}
          </div>
        </div>

        {/* coverage + progress strip */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <CoverageBanner coverage={coverage} />
          <span className={cn("rounded px-2 py-0.5 font-medium", uncheckedActive === 0 && activeRows.length > 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>
            {activeRows.length - uncheckedActive}/{activeRows.length} lines confirmed
          </span>
          {needsItemCount > 0 && <span className="rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600">{needsItemCount} need item</span>}
          {undisposed.length > 0 && <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-[var(--muted-foreground)]">confirm: {undisposed.join(", ")}</span>}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter particulars…" className="h-7 w-44 rounded border border-[var(--border)] bg-[var(--background)] pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
          </div>
        </div>
      </div>

      {/* groups */}
      {GROUP_ORDER.map((g) => {
        const tmpl = (templateByGroup[g] || []).filter(matchFilter);
        const otherRows = g === "OTHER" ? (rows[OTHER_SECTION_KEY] || []) : [];
        if (!tmpl.length && !otherRows.length) return null;
        const isCollapsed = collapsed.has(g);
        const greyShown = showGreyed.has(g);
        const groupActive = (g === "OTHER" ? [OTHER_SECTION_KEY] : tmpl.map((s) => s.key)).flatMap((k) => rows[k] || []).filter((r) => !r.not_required && (r.item_id || (r.name && r.name.trim())));
        const groupChecked = groupActive.filter((r) => r.checked).length;
        const greyCount = g === "OTHER" ? 0 : tmpl.filter((s) => !(rows[s.key]?.length)).length;

        return (
          <div key={g} className="mb-3 overflow-hidden rounded-lg border border-[var(--border)]">
            <div className="flex items-center gap-2 bg-[var(--muted)]/40 px-3 py-2">
              <button onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(g) ? n.delete(g) : n.add(g); return n; })} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)] cursor-pointer">
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {glabel(g)}
              </button>
              <span className="text-xs text-[var(--muted-foreground)]">{groupChecked}/{groupActive.length} confirmed{greyCount ? ` · ${greyCount} n/a` : ""}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onSaveSection(g)} disabled={!!busy} title="Save just this section">Save section</Button>
                {dispositions[g] ? (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><CircleCheck className="h-3.5 w-3.5" /> Confirmed</span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => confirmGroup(g)}>Confirm section</Button>
                )}
              </div>
            </div>

            {!isCollapsed && (
              <div className="divide-y divide-[var(--border)]">
                {g === "OTHER"
                  ? otherRows.map((r) => <LineRow key={r.uid} sk={OTHER_SECTION_KEY} sec={null} row={r} onPatch={patchRow} onRemove={removeRow} onToggle={toggleCheck} />)
                  : tmpl.map((sec) => {
                      const secRows = rows[sec.key] || [];
                      if (!secRows.length) {
                        if (!greyShown) return null;
                        return (
                          <div key={sec.key} className="flex items-center gap-2 px-3 py-1 text-xs text-[var(--muted-foreground)] opacity-60">
                            <span className="h-3.5 w-3.5" />
                            <span className="flex-1 truncate">{sec.label}</span>
                            <span className="italic">not applicable</span>
                            <button onClick={() => addRow(sec.key)} className="rounded px-1.5 py-0.5 text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer">+ add</button>
                          </div>
                        );
                      }
                      return (
                        <div key={sec.key}>
                          {secRows.map((r, i) => <LineRow key={r.uid} sk={sec.key} sec={sec} row={r} label={i === 0 ? sec.label : ""} onPatch={patchRow} onRemove={removeRow} onToggle={toggleCheck} />)}
                          <div className="px-3 pb-1 pl-9">
                            <button onClick={() => addRow(sec.key)} className="text-xs text-[var(--primary)] hover:underline cursor-pointer">+ add line</button>
                          </div>
                        </div>
                      );
                    })}
                {g !== "OTHER" && greyCount > 0 && (
                  <button onClick={() => setShowGreyed((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; })} className="w-full px-3 py-1 text-left text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40 cursor-pointer">
                    {greyShown ? "Hide" : "Show"} {greyCount} not-applicable particular{greyCount > 1 ? "s" : ""}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {confirmGen && (
        <ConfirmDialog
          title="Regenerate Part List?"
          message="This replaces the current list with a freshly generated draft (your manual edits and checks on this list will be cleared). Continue?"
          confirmLabel="Regenerate" confirmVariant="destructive" busy={busy === "generate"}
          onConfirm={runGenerate} onCancel={() => setConfirmGen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------ subcomponents ------------------------------ */

function StatusBadge({ status }: { status: "draft" | "ready" }) {
  return status === "ready"
    ? <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> Ready</span>
    : <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">Draft</span>;
}

function CoverageBanner({ coverage }: { coverage: { total: number; covered: number; unmapped: { item_name: string | null; category: string }[] } }) {
  const ok = coverage.total === 0 || coverage.covered >= coverage.total;
  return (
    <span className={cn("flex items-center gap-1 rounded px-2 py-0.5 font-medium", ok ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600")} title={ok ? "" : coverage.unmapped.map((u) => u.item_name || u.category).join(", ")}>
      {ok ? <CircleCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      BOM {coverage.covered}/{coverage.total} placed
    </span>
  );
}

// sources are already human-readable ("rule", "rule + drawing", "BOM", "BOM + rule"); show as-is
const SRC_LABEL: Record<string, string> = {};
const confColor = (c: string | null) => (c === "high" ? "bg-emerald-500" : c === "medium" ? "bg-amber-500" : "bg-[var(--muted-foreground)]");

interface LineRowProps {
  sk: string;
  sec: PackingSection | null; // null = OTHER (free-form, has its own name)
  row: Row;
  label?: string;
  onPatch: (sk: string, uid: string, patch: Partial<Row>) => void;
  onRemove: (sk: string, row: Row) => void;
  onToggle: (sk: string, row: Row) => void;
}

function LineRow({ sk, sec, row, label, onPatch, onRemove, onToggle }: LineRowProps) {
  const isFree = sec?.captureType === "free";
  const dismissed = row.not_required;
  const needsItem = !dismissed && !isFree && !row.item_id && !row.non_inventory;
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 text-[13px]", dismissed && "opacity-50", row.is_conflict && "bg-red-500/5")}>
      {/* check */}
      <button onClick={() => onToggle(sk, row)} title={row.checked ? "Confirmed" : "Confirm this line"}
        className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border cursor-pointer", row.checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-[var(--border)] hover:border-[var(--primary)]")}>
        {row.checked && <Check className="h-3 w-3" />}
      </button>

      {/* label + chips */}
      <div className="flex w-52 shrink-0 items-center gap-1.5">
        <span className="truncate" title={sec?.label || row.name || ""}>{sec ? (label ?? sec.label) : (row.name || "(BOM item)")}</span>
        {row.is_conflict && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label={row.conflict_note || "conflict"} />}
        {needsItem && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600">needs item</span>}
        {row.non_inventory && <span className="shrink-0 rounded bg-violet-500/15 px-1 text-[10px] font-medium text-violet-600">non-stock</span>}
      </div>

      {/* item picker / free text / non-stock */}
      <div className="min-w-0 flex-1">
        {isFree
          ? <input value={row.name || ""} onChange={(e) => onPatch(sk, row.uid, { name: e.target.value })} placeholder={`e.g. ${sec?.specHint || "spec"}`} className="h-7 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
          : row.non_inventory
            ? <div className="flex h-7 items-center px-2 text-[13px] italic text-[var(--muted-foreground)]">Non-stock — no inventory item (spec only)</div>
            : <ItemPicker sk={sk === OTHER_SECTION_KEY ? "" : sk} row={row} onPick={(it) => onPatch(sk, row.uid, { item_id: it.id, code: it.code, name: it.name, uom: it.uom_abbreviation })} onClear={() => onPatch(sk, row.uid, { item_id: null, code: null, name: null, uom: null })} />}
      </div>

      {/* non-stock toggle (item-type rows only) */}
      {!isFree && (
        <button
          onClick={() => onPatch(sk, row.uid, row.non_inventory ? { non_inventory: false } : { non_inventory: true, item_id: null, code: null, name: null, uom: null })}
          title="Mark as a non-stock item (no inventory SKU — e.g. fish plate, cut part)"
          className={cn("shrink-0 rounded border px-1 text-[10px] cursor-pointer", row.non_inventory ? "border-violet-400 bg-violet-500/15 text-violet-600" : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-violet-400")}
        >
          non-stock
        </button>
      )}

      {/* spec */}
      <input value={row.spec || ""} onChange={(e) => onPatch(sk, row.uid, { spec: e.target.value })} placeholder="spec" className="h-7 w-24 shrink-0 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />

      {/* qty */}
      <input type="number" min={0} step="any" value={row.qty || ""} onChange={(e) => onPatch(sk, row.uid, { qty: e.target.value ? Number(e.target.value) : 0 })} placeholder="Qty" className="h-7 w-14 shrink-0 rounded border border-[var(--border)] bg-[var(--background)] px-1 text-right text-[13px] tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />

      {/* source + confidence */}
      <div className="flex w-20 shrink-0 items-center justify-end gap-1">
        {row.confidence && <span className={cn("h-1.5 w-1.5 rounded-full", confColor(row.confidence))} title={`${row.confidence} confidence`} />}
        {row.source && <span className="truncate text-[10px] text-[var(--muted-foreground)]" title={`source: ${row.source}`}>{SRC_LABEL[row.source] || row.source}</span>}
      </div>

      <button onClick={() => onRemove(sk, row)} title={row.bom_line_id ? "Dismiss (from BOM)" : "Remove"} className="shrink-0 text-[var(--muted-foreground)] hover:text-red-500 cursor-pointer">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ItemPicker({ sk, row, onPick, onClear }: { sk: string; row: Row; onPick: (it: SearchableItem) => void; onClear: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      setLoading(true);
      try { setResults(await searchPartItems(sk, query, 30)); } catch { setResults([]); } finally { setLoading(false); }
    }, query ? 200 : 40);
  }, [sk]);

  if (row.item_id) {
    return (
      <div className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--muted)]/30 px-2 py-1">
        <span className="truncate text-[13px]" title={row.name || ""}>{row.name}</span>
        {row.code && <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{row.code}</span>}
        <button onClick={onClear} className="ml-auto shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"><X className="h-3 w-3" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--background)] px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); search(e.target.value); }}
          onFocus={() => { setOpen(true); if (!results.length) search(""); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search item…"
          className="h-7 w-full bg-transparent text-[13px] focus:outline-none"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted-foreground)]" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-[22rem] overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg">
          {results.map((it) => (
            <button key={it.id} onMouseDown={(e) => { e.preventDefault(); onPick(it); setOpen(false); setQ(""); }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-[var(--muted)] cursor-pointer">
              <span className="flex-1 truncate">{it.name}</span>
              <span className={cn("shrink-0 tabular-nums text-[11px]", it.total_stock <= 0 ? "text-red-500" : "text-[var(--muted-foreground)]")}>{it.total_stock}</span>
              <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{it.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
