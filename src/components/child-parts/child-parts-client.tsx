"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Blocks, Hammer, Pencil, Check, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { recordAssemblyRun } from "@/lib/actions/assembly-runs";
import { adjustChildPartStock, type ChildPartGroup } from "@/lib/actions/child-parts";

const KIND_STYLE: Record<string, string> = {
  cut: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  made: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trade: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};
const KIND_TITLE: Record<string, string> = {
  cut: "Cut piece — a program cuts this; stocks automatically as programs run.",
  made: "Made sub-part — produced by a program; stocks automatically as programs run.",
  trade: "Bought (trade) part — procured. Consuming it in a build lowers stock and raises Trade MRP to-buy.",
};

interface Props {
  groups: ChildPartGroup[];
  today: string;
}

export function ChildPartsClient({ groups, today }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(() => readParam(sp, "q", ""));
  useUrlListSync({ q }, { q: "" });

  const filtered = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return groups;
    return groups.filter((g) => {
      const hay = [
        g.parent_name,
        g.parent_code ?? "",
        ...g.children.flatMap((c) => [c.name, c.code ?? ""]),
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [groups, q]);

  const totalChildren = useMemo(
    () => new Set(groups.flatMap((g) => g.children.map((c) => c.item_id))).size,
    [groups],
  );

  return (
    <div>
      <PageHeader
        title="Child Parts"
        icon={<Blocks size={18} />}
        meta={`${groups.length} sub-assemblies · ${totalChildren} parts`}
        subtitle="Each sub-assembly with its full parts list — cut pieces, made sub-parts and bought (trade) parts. Cut/made pieces stock automatically as programs run; correct any count if it drifts, or build a sub-assembly to consume its parts and stock the finished item. Building past what's in stock is allowed (the short part goes negative and shows up in MRP to buy/make)."
      />

      <div className="mb-4 max-w-sm">
        <Input
          size="sm"
          placeholder="Search sub-assembly or part…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          {groups.length === 0
            ? "No sub-assemblies yet. Once an item has a parts list with at least one made part, it shows up here to build."
            : "No sub-assemblies match your search."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((g) => (
            <GroupCard key={g.parent_id} group={g} today={today} onDone={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  today,
  onDone,
}: {
  group: ChildPartGroup;
  today: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [building, setBuilding] = useState(false);

  async function build() {
    if (building) return;
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Build quantity must be greater than 0.");
      return;
    }
    setBuilding(true);
    const res = await recordAssemblyRun({ item_id: group.parent_id, build_date: today, qty });
    setBuilding(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.warning) toast.info(res.warning);
    toast.success(`Built ${qty} × ${group.parent_name}.`);
    onDone();
  }

  const canBuild = group.maxBuildable > 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="min-w-0">
          <Link
            href={`/inventory/${group.parent_id}`}
            className="block truncate text-sm font-semibold hover:text-[var(--primary)] hover:underline"
            title={group.parent_name}
          >
            {group.parent_name}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
            {group.parent_code && <span className="font-mono">{group.parent_code}</span>}
            <span>
              In stock: <span className="font-semibold text-[var(--foreground)]">{group.parent_stock}</span>
            </span>
          </div>
        </div>
        <Badge variant={canBuild ? "success" : "neutral"}>
          {canBuild ? `Can build ${group.maxBuildable}` : "Short on parts"}
        </Badge>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {group.children.map((c) => (
          <ChildRow key={c.item_id} child={c} onDone={onDone} />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-3 py-2">
        <span className="mr-auto text-[11px] text-[var(--muted-foreground)]">Build sub-assembly:</span>
        <Input
          size="sm"
          type="number"
          min={1}
          className="w-16"
          value={qty}
          onChange={(e) => setQty(parseInt(e.target.value, 10) || 0)}
        />
        <Button size="sm" variant="primary" onClick={build} disabled={building} className="cursor-pointer">
          <Hammer size={14} />
          {building ? "Building…" : "Build"}
        </Button>
      </div>
    </div>
  );
}

function ChildRow({
  child,
  onDone,
}: {
  child: ChildPartGroup["children"][number];
  onDone: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(child.stock);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    if (!Number.isFinite(val)) {
      toast.error("Enter a valid quantity.");
      return;
    }
    setSaving(true);
    const res = await adjustChildPartStock(child.item_id, val);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${child.code ?? child.name} set to ${val}.`);
    setEditing(false);
    onDone();
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          KIND_STYLE[child.kind],
        )}
        title={KIND_TITLE[child.kind]}
      >
        {child.kind}
      </span>
      <Link
        href={`/inventory/${child.item_id}`}
        className="min-w-0 flex-1 truncate hover:text-[var(--primary)] hover:underline"
        title={child.name}
      >
        {child.name}
      </Link>
      <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">×{child.perBuild}</span>
      {editing ? (
        <div className="flex shrink-0 items-center gap-1">
          <Input
            size="sm"
            type="number"
            className="w-16"
            value={val}
            autoFocus
            onChange={(e) => setVal(parseInt(e.target.value, 10) || 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setVal(child.stock);
                setEditing(false);
              }
            }}
          />
          <button
            type="button"
            onClick={save}
            disabled={saving}
            aria-label="Save"
            className="rounded p-1 text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              setVal(child.stock);
              setEditing(false);
            }}
            aria-label="Cancel"
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setVal(child.stock);
            setEditing(true);
          }}
          className="group flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--muted)] cursor-pointer"
          title="Correct this count"
        >
          <span className={cn("font-semibold tabular-nums", child.stock < 0 && "text-[var(--destructive)]")}>
            {child.stock}
          </span>
          <Pencil size={12} className="text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}
