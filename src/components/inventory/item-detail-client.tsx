"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Loader2,
  Save,
  Check,
  ShoppingCart,
  Scissors,
  Boxes,
  Wrench,
  Puzzle,
  ArrowUpFromLine,
  ArrowDownToLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ItemRow } from "@/components/jobs/item-row";
import { ItemFormModal } from "@/components/inventory/item-form-modal";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import {
  saveItemBom,
  type ItemBomResult,
  type ItemBomLineDetail,
  type ItemBomLineInput,
} from "@/lib/actions/item-bom";
import type {
  FinishRule,
  ItemCategory,
  UnitOfMeasurement,
  ItemType,
} from "@/lib/supabase/types";
import type { ItemOperationRef } from "@/lib/actions/operations";

type BomRow = PickedItem & { finishRule: FinishRule };

const makeKey = () => Math.random().toString(36).slice(2);
const emptyRow = (): BomRow => ({
  _key: makeKey(),
  item_id: null,
  item_code: "",
  item_name: "",
  uom: "",
  category_name: null,
  required_quantity: 1,
  family: null,
  finish: null,
  finishRule: "neutral",
});

const lineToRow = (l: ItemBomLineDetail): BomRow => ({
  _key: makeKey(),
  item_id: l.child_item_id,
  item_code: l.child_code ?? "",
  item_name: l.child_name ?? "",
  uom: l.child_uom ?? "",
  category_name: null,
  required_quantity: l.qty,
  family: l.child_item_family,
  finish: l.child_item_finish,
  finishRule: l.finish_rule,
});

const rowToInput = (r: BomRow): ItemBomLineInput => ({
  child_item_id: r.item_id,
  child_family: r.finishRule === "neutral" ? null : r.family ?? null,
  qty: r.required_quantity || 0,
  finish_rule: r.finishRule,
  pinned_finish: r.finishRule === "pinned" ? r.finish ?? null : null,
});

interface Props {
  bom: ItemBomResult;
  producedBy: ItemOperationRef[];
  consumedBy: ItemOperationRef[];
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
}

export function ItemDetailClient({
  bom,
  producedBy,
  consumedBy,
  categories,
  units,
  itemRefs,
}: Props) {
  const router = useRouter();
  const { item } = bom;

  const seedRows = (filter: (l: ItemBomLineDetail) => boolean): BomRow[] => {
    const rows = bom.lines.filter(filter).map(lineToRow);
    return rows.length ? rows : [emptyRow()];
  };
  const [builtRows, setBuiltRows] = useState<BomRow[]>(() =>
    seedRows((l) => l.child_stock_behaviour !== "phantom"),
  );
  const [looseRows, setLooseRows] = useState<BomRow[]>(() =>
    seedRows((l) => l.child_stock_behaviour === "phantom"),
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showCreateLoose, setShowCreateLoose] = useState(false);

  const isTrade = item.effective_procurement_type === "trade";
  const hasBom = bom.lines.length > 0;
  const identity = isTrade
    ? "bought"
    : hasBom
      ? "assembled"
      : producedBy.length > 0
        ? "cut"
        : "make";

  const updater =
    (setRows: React.Dispatch<React.SetStateAction<BomRow[]>>) =>
    (key: string, patch: Partial<BomRow>) =>
      setRows((rs) =>
        rs.map((r) => {
          if (r._key !== key) return r;
          const next = { ...r, ...patch };
          if (!next.family && next.finishRule !== "neutral") next.finishRule = "neutral";
          return next;
        }),
      );
  const adder =
    (setRows: React.Dispatch<React.SetStateAction<BomRow[]>>) => () =>
      setRows((rs) => [...rs, emptyRow()]);
  const remover =
    (setRows: React.Dispatch<React.SetStateAction<BomRow[]>>) => (key: string) =>
      setRows((rs) => {
        const next = rs.filter((r) => r._key !== key);
        return next.length ? next : [emptyRow()];
      });

  const save = () => {
    setError(null);
    const lines = [...builtRows, ...looseRows]
      .filter((r) => r.item_id)
      .map(rowToInput);
    startTransition(async () => {
      const res = await saveItemBom(item.id, lines);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const IDENTITY = {
    bought: { label: "Bought", variant: "amber" as const, Icon: ShoppingCart, hint: "Purchased from a supplier — planning raises a purchase order." },
    cut: { label: "Made — cut", variant: "blue" as const, Icon: Scissors, hint: "Produced directly by a CNC program (see below)." },
    assembled: { label: "Made — assembled", variant: "purple" as const, Icon: Boxes, hint: "Built from the parts listed below." },
    make: { label: "Made", variant: "green" as const, Icon: Wrench, hint: "A make item — list its stocked sub-parts and loose parts below." },
  }[identity];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/inventory" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Inventory
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{item.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="font-mono text-xs text-[var(--muted-foreground)]">{item.code}</span>
              <Badge variant={IDENTITY.variant}>
                <IDENTITY.Icon className="h-3 w-3 mr-1" />
                {IDENTITY.label}
              </Badge>
              {item.family && (
                <Badge variant="neutral" title="Finish family">
                  {item.family}{item.finish ? ` · ${item.finish}` : ""}
                </Badge>
              )}
              {item.stock_behaviour !== "stocked" && (
                <Badge variant={item.stock_behaviour === "tooling" ? "neutral" : "purple"}>
                  {item.stock_behaviour}
                </Badge>
              )}
            </div>
            <p className="text-sm text-[var(--muted-foreground)] mt-2">{IDENTITY.hint}</p>
          </div>
          <Link href={`/inventory?edit=${item.id}`} className="shrink-0">
            <Button variant="secondary">Edit item</Button>
          </Link>
        </div>
      </div>

      {producedBy.length > 0 && (
        <ProgramChips title="Produced by" icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} ops={producedBy} />
      )}

      {!isTrade && (
        <>
          {/* Stocked sub-parts */}
          <PartsSection
            title="Built from"
            subtitle="stocked sub-parts this item is assembled from"
            icon={<Boxes className="h-4 w-4" />}
            rows={builtRows}
            onUpdate={updater(setBuiltRows)}
            onAdd={adder(setBuiltRows)}
            onRemove={remover(setBuiltRows)}
            searchLabel="sub-part"
            saved={saved}
            isPending={isPending}
            onSave={save}
            error={error}
          />

          {/* Loose parts (phantoms) cut on programs and fitted in */}
          <div className="mt-4">
            <PartsSection
              title="Assembly parts"
              subtitle="loose parts (cut on programs, never stocked) fitted into this item"
              icon={<Puzzle className="h-4 w-4" />}
              rows={looseRows}
              onUpdate={updater(setLooseRows)}
              onAdd={adder(setLooseRows)}
              onRemove={remover(setLooseRows)}
              searchLabel="loose part"
              onCreate={() => setShowCreateLoose(true)}
              createLabel="Create loose part"
              onSave={save}
              saved={saved}
              isPending={isPending}
              error={error}
            />
          </div>
        </>
      )}

      {isTrade && (
        <div className="card-surface p-4 mb-4 text-sm text-[var(--muted-foreground)]">
          This is a <span className="font-medium text-[var(--foreground)]">bought</span> item —
          purchased from a supplier, so it has no parts list.
        </div>
      )}

      {consumedBy.length > 0 && (
        <div className="mt-4">
          <ProgramChips title="Consumed by" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} ops={consumedBy} />
        </div>
      )}

      {showCreateLoose && (
        <ItemFormModal
          categories={categories}
          units={units}
          items={itemRefs}
          createDefaults={{ item_type: "sub_assembly", stock_behaviour: "phantom" }}
          onClose={() => setShowCreateLoose(false)}
          onSaved={() => setShowCreateLoose(false)}
          onCreated={(created) =>
            setLooseRows((rs) => [
              ...rs.filter((r) => r.item_id),
              {
                ...emptyRow(),
                item_id: created.id,
                item_code: created.code,
                item_name: created.name,
                uom: created.uom,
              },
              emptyRow(),
            ])
          }
        />
      )}
    </div>
  );
}

function ProgramChips({
  title,
  icon,
  ops,
}: {
  title: string;
  icon: React.ReactNode;
  ops: ItemOperationRef[];
}) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)] mb-2">
        {icon} {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ops.map((op) => (
          <Link
            key={op.id}
            href={`/programs/${op.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] cursor-pointer"
            title={op.code ?? op.name}
          >
            <span className="font-medium">{op.name}</span>
            <span className="text-[var(--muted-foreground)]">×{op.qty_per_run}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PartsSection({
  title,
  subtitle,
  icon,
  rows,
  onUpdate,
  onAdd,
  onRemove,
  searchLabel,
  onSave,
  saved,
  isPending,
  error,
  onCreate,
  createLabel,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: BomRow[];
  onUpdate: (key: string, patch: Partial<BomRow>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  searchLabel: string;
  onSave?: () => void;
  saved?: boolean;
  isPending?: boolean;
  error?: string | null;
  onCreate?: () => void;
  createLabel?: string;
}) {
  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]/40">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-[var(--muted-foreground)]">· {subtitle}</span>
        {onSave && (
          <div className="ml-auto flex items-center gap-2">
            {saved && (
              <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            <Button size="sm" onClick={onSave} disabled={isPending}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save parts list
            </Button>
          </div>
        )}
      </div>
      <div className="p-4">
        {error && (
          <div className="mb-3 p-2.5 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row._key} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <ItemRow
                  row={row}
                  scopeCategories={undefined}
                  sectionCategory={searchLabel}
                  onUpdate={(patch) => onUpdate(row._key, patch)}
                  onRemove={rows.length > 1 || row.item_id ? () => onRemove(row._key) : undefined}
                />
              </div>
              <select
                value={row.finishRule}
                onChange={(e) => onUpdate(row._key, { finishRule: e.target.value as FinishRule })}
                disabled={!row.item_id}
                title="How is this part's finish decided?"
                className="h-8 w-[170px] shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm cursor-pointer hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] transition-colors disabled:opacity-50"
              >
                <option value="neutral">This exact item</option>
                {row.family && <option value="inherit">Matches parent finish</option>}
                {row.family && <option value="pinned">Always {row.finish ?? "this finish"}</option>}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4">
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
          >
            <Plus className="h-3 w-3" /> Add {searchLabel}
          </button>
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
            >
              <Plus className="h-3 w-3" /> {createLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
