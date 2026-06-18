"use client";

import { useState, useMemo, useCallback, useTransition, memo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ChevronRight, Plus, Save, Search, X, Package, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportRowsToXlsx } from "@/lib/export/xlsx";
import {
  PACKING_SECTIONS, packingSection, type PackingSection,
} from "@/lib/packing-list/packing-list-sections";
import {
  savePackingList,
  type PackingListData, type PackingSectionInput,
} from "@/lib/actions/packing-list";
import { OTHER_SECTION_KEY } from "@/lib/packing-list/helpers";
import { PackingRow, type PackingRowState } from "@/components/jobs/packing-row";

interface Props {
  jobId: string;
  jobNumber: string;
  customerName: string | null;
  data: PackingListData;
}

let _kc = 0;
const newKey = () => `r${++_kc}`;
const emptyRow = (): PackingRowState => ({
  _key: newKey(), item_id: null, code: null, name: null, uom: null, qty: 0,
});

/** Pseudo-section for any seeded lines whose key isn't a known particular. */
const OTHER_SECTION: PackingSection = {
  key: OTHER_SECTION_KEY,
  label: "Other / Unsectioned",
  captureType: "item",
  categoryPaths: [],
  specHint: "",
};

const captureOf = (key: string) => packingSection(key)?.captureType ?? "item";

export function PackingListClient({ jobId, jobNumber, customerName, data }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSave] = useTransition();

  // section_key → rows
  const [sections, setSections] = useState<Record<string, PackingRowState[]>>(() => {
    const out: Record<string, PackingRowState[]> = {};
    for (const [key, lines] of Object.entries(data.linesBySection)) {
      out[key] = lines.map((l) => ({
        _key: newKey(), item_id: l.item_id, code: l.code, name: l.name, uom: l.uom, qty: l.qty,
      }));
    }
    return out;
  });

  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [k, lines] of Object.entries(data.linesBySection)) if (lines.length) s.add(k);
    return s;
  });

  const markDirty = useCallback((key: string) => {
    setDirty((d) => (d.has(key) ? d : new Set(d).add(key)));
  }, []);

  const allSections = useMemo(() => {
    const list = [...PACKING_SECTIONS];
    if ((sections[OTHER_SECTION_KEY]?.length ?? 0) > 0) list.push(OTHER_SECTION);
    return list;
  }, [sections]);

  // A row "counts" if it has a picked item, a free-text spec, or a quantity.
  const rowFilled = (r: PackingRowState) => !!r.item_id || !!(r.name && r.name.trim()) || !!r.qty;
  const countOf = (key: string) => sections[key]?.filter(rowFilled).length ?? 0;

  const totalLines = useMemo(
    () => Object.entries(sections).reduce((n, [, rows]) => n + rows.filter(rowFilled).length, 0),
    [sections],
  );
  const filledSections = useMemo(
    () => allSections.filter((s) => countOf(s.key) > 0).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, allSections],
  );

  const visibleSections = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return allSections.filter((s) => {
      if (onlyFilled && countOf(s.key) === 0) return false;
      if (!f) return true;
      return s.label.toLowerCase().includes(f) || s.specHint.toLowerCase().includes(f);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSections, filter, onlyFilled, sections]);

  /* ---- row mutations (only the touched section's array changes identity) ---- */
  const updateRow = useCallback((key: string, rowKey: string, patch: Partial<PackingRowState>) => {
    setSections((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).map((r) => (r._key === rowKey ? { ...r, ...patch } : r)),
    }));
    markDirty(key);
  }, [markDirty]);

  const removeRow = useCallback((key: string, rowKey: string) => {
    setSections((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((r) => r._key !== rowKey) }));
    markDirty(key);
  }, [markDirty]);

  const addRow = useCallback((key: string) => {
    setSections((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), emptyRow()] }));
    setExpanded((e) => new Set(e).add(key));
    markDirty(key);
  }, [markDirty]);

  const toggle = useCallback((key: string) => {
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }, []);

  const expandAll = () => setExpanded(new Set(visibleSections.map((s) => s.key)));
  const collapseAll = () => setExpanded(new Set());

  /* ---- save ---- */
  const handleSave = () => {
    if (dirty.size === 0) { toast.info("Nothing to save"); return; }
    const payload: PackingSectionInput[] = [...dirty].map((key) => {
      const free = captureOf(key) === "free";
      return {
        section_key: key,
        lines: (sections[key] ?? [])
          .filter(rowFilled)
          .map((r) => ({
            item_id: free ? null : r.item_id,
            // free-text rows store the typed Specification in `label`.
            label: free ? (r.name?.trim() || null) : null,
            qty: r.qty,
            note: null,
          })),
      };
    });
    startSave(async () => {
      const res = await savePackingList(jobId, payload);
      if (res.ok) {
        setDirty(new Set());
        toast.success("Packing list saved");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  /* ---- export ---- */
  const handleExport = () => {
    const rows: { particulars: string; spec: string; code: string; qty: number; unit: string }[] = [];
    for (const s of allSections) {
      for (const r of sections[s.key] ?? []) {
        if (!rowFilled(r)) continue;
        rows.push({
          particulars: s.label,
          spec: r.item_id ? (r.name ?? "") : (r.name ?? ""),
          code: r.code ?? "",
          qty: r.qty,
          unit: r.uom ?? "",
        });
      }
    }
    if (!rows.length) { toast.info("Nothing to export"); return; }
    exportRowsToXlsx({
      rows,
      columns: [
        { header: "Particulars", field: "particulars" },
        { header: "Specification", field: "spec" },
        { header: "Code", field: "code" },
        { header: "Qty", field: "qty" },
        { header: "Unit", field: "unit" },
      ],
      filename: `packing-list-${jobNumber}`,
      sheetName: "Part List",
    });
  };

  return (
    <div className="pb-24">
      <PageHeader
        onBack={() => router.push(`/jobs/${jobId}`)}
        icon={<Package className="h-5 w-5" />}
        title={<span className="flex items-center gap-2">Part List — Job {jobNumber}</span>}
        subtitle={customerName || undefined}
        meta={
          <span className="text-[var(--muted-foreground)]">
            {totalLines} line{totalLines === 1 ? "" : "s"} · {filledSections} of {PACKING_SECTIONS.length} filled
          </span>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={handleExport}>Export</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || dirty.size === 0}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save{dirty.size ? ` (${dirty.size})` : ""}
            </Button>
          </>
        }
      />

      {/* Sticky toolbar */}
      <div className="sticky top-0 z-20 -mx-1 mb-3 flex flex-wrap items-center gap-2 bg-[var(--background)]/95 backdrop-blur px-1 py-2 border-b border-[var(--border)]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a particular…"
            className="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
          {filter && (
            <button onClick={() => setFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} className="cursor-pointer" />
          Only filled
        </label>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="sm" onClick={expandAll}>Expand all</Button>
          <Button variant="ghost" size="sm" onClick={collapseAll}>Collapse all</Button>
        </div>
      </div>

      {/* Particular list (canonical part-list order) */}
      <div className="space-y-1">
        {visibleSections.map((s, i) => (
          <SectionCard
            key={s.key}
            index={i + 1}
            section={s}
            rows={sections[s.key] ?? EMPTY}
            expanded={expanded.has(s.key)}
            dirty={dirty.has(s.key)}
            onToggle={toggle}
            onAdd={addRow}
            onUpdate={updateRow}
            onRemove={removeRow}
          />
        ))}
        {visibleSections.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">No particulars match “{filter}”.</div>
        )}
      </div>
    </div>
  );
}

const EMPTY: PackingRowState[] = [];

/* --------------------------- particular card --------------------------- */

interface SectionCardProps {
  index: number;
  section: PackingSection;
  rows: PackingRowState[];
  expanded: boolean;
  dirty: boolean;
  onToggle: (key: string) => void;
  onAdd: (key: string) => void;
  onUpdate: (key: string, rowKey: string, patch: Partial<PackingRowState>) => void;
  onRemove: (key: string, rowKey: string) => void;
}

const SectionCard = memo(function SectionCard({
  index, section, rows, expanded, dirty, onToggle, onAdd, onUpdate, onRemove,
}: SectionCardProps) {
  const free = section.captureType === "free";
  const filled = rows.filter((r) => r.item_id || (r.name && r.name.trim()) || r.qty).length;

  return (
    <div className={cn(
      "rounded-md border bg-[var(--card)]",
      filled > 0 ? "border-[var(--border-strong)]" : "border-[var(--border)]",
    )}>
      <button
        type="button"
        onClick={() => onToggle(section.key)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer hover:bg-[var(--muted)]/50 rounded-md"
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform", expanded && "rotate-90")} />
        <span className="text-[11px] tabular-nums text-[var(--muted-foreground)] w-7 shrink-0">{index}</span>
        <span className="text-[13px] font-medium leading-tight">{section.label}</span>
        {free && <Badge variant="neutral" className="text-[9px] px-1" title="Free-text line (not an inventory item)">text</Badge>}
        {filled > 0 ? (
          <Badge variant="blue" className="text-[10px] px-1.5">{filled}</Badge>
        ) : (
          <span className="text-[11px] text-[var(--muted-foreground)]">empty</span>
        )}
        {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
        {section.specHint && !expanded && (
          <span className="ml-auto truncate text-[11px] italic text-[var(--muted-foreground)] max-w-[40%]">e.g. {section.specHint}</span>
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 pt-0.5 space-y-1">
          {rows.map((r) => (
            <PackingRow
              key={r._key}
              sectionKey={section.key}
              sectionLabel={section.label}
              hint={section.specHint}
              freeText={free}
              row={r}
              onUpdate={(patch) => onUpdate(section.key, r._key, patch)}
              onRemove={() => onRemove(section.key, r._key)}
              onQtyEnter={() => onAdd(section.key)}
            />
          ))}
          <button
            type="button"
            onClick={() => onAdd(section.key)}
            className="flex items-center gap-1 text-[12px] font-medium text-[var(--primary)] hover:underline cursor-pointer pl-1 pt-0.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>
      )}
    </div>
  );
});
