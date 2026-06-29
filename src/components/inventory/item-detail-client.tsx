"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardBody, SectionHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ItemRow } from "@/components/jobs/item-row";
import { LoosePartPicker } from "@/components/inventory/loose-part-picker";
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

  // Child parts that should be made by a program but aren't (computed server-side
  // from the SAVED parts list — make pieces, not sub-assemblies, with no program).
  const missingProgramChildren = bom.lines.filter((l) => l.child_missing_program);
  const hasBom = bom.lines.length > 0;
  const realBuilt = builtRows.filter((r) => r.item_id).length;
  const realLoose = looseRows.filter((r) => r.item_id).length;
  // Guardrail: a MADE item that lists only bought ("Built from") parts, has no
  // loose (Assembly) part, and isn't itself a program's output won't get a
  // production run — the planner has no way to make it. Flag it (non-blocking).
  const noProductionRoute =
    !isTrade && realBuilt > 0 && realLoose === 0 && producedBy.length === 0;
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
      {/* Header. Item detail is reached from many sections (inventory, cabin
          pages, MRP, sub-assemblies, programs) — go back to wherever the user
          came from, not a hardcoded Inventory. Fall back to /inventory only on
          a direct deep-link. */}
      <PageHeader
        title={item.name}
        meta={<span className="font-mono">{item.code}</span>}
        subtitle={IDENTITY.hint}
        onBack={() =>
          window.history.length > 1 ? router.back() : router.push("/inventory")
        }
        actions={
          <Link href={`/inventory?edit=${item.id}`}>
            <Button size="sm" variant="secondary">Edit item</Button>
          </Link>
        }
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {item.effective_procurement_type === "make" ? (
          <Badge variant="blue" title="Make — manufactured in-house">Make</Badge>
        ) : item.effective_procurement_type === "trade" ? (
          <Badge variant="amber" title="Trade — purchased from suppliers">Trade</Badge>
        ) : null}
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

      {producedBy.length > 0 && (
        <ProgramChips title="Produced by" icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} ops={producedBy} />
      )}

      {!isTrade && (
        <>
          {missingProgramChildren.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">
                  {missingProgramChildren.length} child part
                  {missingProgramChildren.length === 1 ? "" : "s"} have no
                  producing program:
                </span>{" "}
                {missingProgramChildren
                  .map((l) => l.child_name || l.child_code || "(unnamed)")
                  .join(", ")}
                . Each is a make piece with no program that cuts/produces it, so
                planning can&apos;t make this assembly. Add a program that outputs
                each piece (or, if a piece is actually bought, set it to Trade).
              </span>
            </div>
          )}
          {noProductionRoute && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">No production route.</span> This made
                item is built only from bought parts and no program produces it, so
                planning can&apos;t schedule a run for it. If it&apos;s cut whole by a
                program, open that program and add this item as an output — planning
                will then schedule the run automatically and still buy the parts
                below. If it&apos;s hand-assembled from the bought parts, you can
                ignore this.
              </span>
            </div>
          )}
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
            <LoosePartsSection
              rows={looseRows}
              onUpdate={updater(setLooseRows)}
              onAdd={adder(setLooseRows)}
              onRemove={remover(setLooseRows)}
              onCreate={() => setShowCreateLoose(true)}
              onSave={save}
              saved={saved}
              isPending={isPending}
              error={error}
            />
          </div>
        </>
      )}

      {isTrade && (
        <Card className="mb-4">
          <CardBody className="text-sm text-[var(--muted-foreground)]">
            This is a <span className="font-medium text-[var(--foreground)]">bought</span> item —
            purchased from a supplier, so it has no parts list.
          </CardBody>
        </Card>
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
    <Card>
      <CardBody>
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
      </CardBody>
    </Card>
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
    <Card>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            {icon}
            {title}
            <span className="text-xs font-normal text-[var(--muted-foreground)]">· {subtitle}</span>
          </span>
        }
        actions={
          onSave ? (
            <>
              {saved && (
                <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              <Button size="sm" onClick={onSave} disabled={isPending}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save parts list
              </Button>
            </>
          ) : undefined
        }
      />
      <CardBody>
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
              <Select
                size="sm"
                value={row.finishRule}
                onChange={(e) => onUpdate(row._key, { finishRule: e.target.value as FinishRule })}
                disabled={!row.item_id}
                title="How is this part's finish decided?"
                className="w-[170px] shrink-0"
              >
                <option value="neutral">This exact item</option>
                {row.family && <option value="inherit">Matches parent finish</option>}
                {row.family && <option value="pinned">Always {row.finish ?? "this finish"}</option>}
              </Select>
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
      </CardBody>
    </Card>
  );
}

/**
 * Assembly-parts section. Same card chrome as PartsSection, but each row uses
 * the LoosePartPicker (searches only loose parts — phantom items + program
 * cut_part labels — never the full inventory). No finish-rule column: a loose
 * part is a concrete cut piece (neutral).
 */
function LoosePartsSection({
  rows,
  onUpdate,
  onAdd,
  onRemove,
  onCreate,
  onSave,
  saved,
  isPending,
  error,
}: {
  rows: BomRow[];
  onUpdate: (key: string, patch: Partial<BomRow>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onCreate: (query: string) => void;
  onSave: () => void;
  saved: boolean;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Puzzle className="h-4 w-4" />
            Assembly parts
            <span className="text-xs font-normal text-[var(--muted-foreground)]">
              · loose parts (cut on programs, never stocked) fitted into this item
            </span>
          </span>
        }
        actions={
          <>
            {saved && (
              <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            <Button size="sm" onClick={onSave} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save parts list
            </Button>
          </>
        }
      />
      <CardBody>
        {error && (
          <div className="mb-3 p-2.5 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          {rows.map((row) => (
            <LoosePartPicker
              key={row._key}
              itemId={row.item_id}
              itemName={row.item_name}
              itemCode={row.item_code}
              uom={row.uom}
              qty={row.required_quantity}
              onPick={(p) =>
                onUpdate(row._key, {
                  item_id: p.id,
                  item_code: p.code,
                  item_name: p.name,
                  uom: p.uom,
                  required_quantity: row.required_quantity || 1,
                  finishRule: "neutral",
                  family: null,
                  finish: null,
                })
              }
              onClear={() =>
                onUpdate(row._key, {
                  item_id: null,
                  item_code: "",
                  item_name: "",
                  uom: "",
                })
              }
              onQty={(n) => onUpdate(row._key, { required_quantity: n })}
              onRemove={
                rows.length > 1 || row.item_id
                  ? () => onRemove(row._key)
                  : undefined
              }
              onCreateNew={(q) => onCreate(q)}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4">
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
          >
            <Plus className="h-3 w-3" /> Add loose part
          </button>
          <button
            type="button"
            onClick={() => onCreate("")}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
          >
            <Plus className="h-3 w-3" /> Create loose part
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
