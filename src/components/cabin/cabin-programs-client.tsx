"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { Plus, Search, Cog, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { CabinProgramFormModal } from "@/components/cabin/cabin-program-form-modal";
import {
  setCabinProgramAudited,
  getCabinProgramDetail,
  type CabinProgramListRow,
  type CabinProgramDetail,
} from "@/lib/actions/cabin-programs";
import { CABIN_PROGRAM_CATEGORIES } from "@/lib/cabin/cabin-program-meta";

const MACHINE_LABEL: Record<string, string> = {
  cnc_laser: "Laser", cnc_punch: "Punch", assembly_fit: "Assembly",
};

export function CabinProgramsClient({ programs }: { programs: CabinProgramListRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [cat, setCat] = useState(() => readParam(sp, "cat", "all"));
  const [audit, setAudit] = useState(() => readParam(sp, "audit", "all", ["all", "audited", "pending"]));
  useUrlListSync({ q: search, cat, audit }, { q: "", cat: "all", audit: "all" });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CabinProgramDetail | null>(null);
  const [auditing, setAuditing] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const byCat: Record<string, number> = { all: programs.length };
    let audited = 0;
    for (const p of programs) {
      byCat[p.category] = (byCat[p.category] ?? 0) + 1;
      if (p.audited) audited++;
    }
    return { byCat, audited, pending: programs.length - audited };
  }, [programs]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return programs.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      if (audit === "audited" && !p.audited) return false;
      if (audit === "pending" && p.audited) return false;
      if (tokens.length) {
        const hay = `${p.name} ${p.code ?? ""} ${p.category} ${p.input_sheet_name ?? ""}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [programs, search, cat, audit]);

  const openEdit = async (id: string) => {
    const detail = await getCabinProgramDetail(id);
    if (detail) { setEditing(detail); setShowForm(true); }
  };

  const toggleAudit = async (p: CabinProgramListRow) => {
    setAuditing((s) => new Set(s).add(p.id));
    const res = await setCabinProgramAudited(p.id, !p.audited);
    setAuditing((s) => { const n = new Set(s); n.delete(p.id); return n; });
    if (res.ok) { toast.success(p.audited ? "Marked pending" : "Marked audited"); router.refresh(); }
    else toast.error(res.error ?? "Failed");
  };

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-md text-xs cursor-pointer border transition-colors",
        active ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)] font-medium" : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
      )}
    >
      {children}
    </button>
  );

  return (
    <div>
      <PageHeader
        icon={<Cog size={18} />}
        title="Cabin Programs"
        meta={`${counts.audited} audited · ${counts.pending} pending`}
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus size={16} className="mr-1.5" /> New Cabin Program
          </Button>
        }
      />

      <Toolbar>
        <div className="relative w-full max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input size="sm" placeholder="Search name, code, sheet…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-1.5">
          <Chip active={cat === "all"} onClick={() => setCat("all")}>All · {counts.byCat.all ?? 0}</Chip>
          {CABIN_PROGRAM_CATEGORIES.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c} · {counts.byCat[c] ?? 0}</Chip>
          ))}
        </div>
        <ToolbarSpacer />
        <div className="flex items-center gap-1.5">
          <Chip active={audit === "all"} onClick={() => setAudit("all")}>All</Chip>
          <Chip active={audit === "audited"} onClick={() => setAudit("audited")}>Audited · {counts.audited}</Chip>
          <Chip active={audit === "pending"} onClick={() => setAudit("pending")}>Pending · {counts.pending}</Chip>
        </div>
      </Toolbar>

      {filtered.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<Cog size={28} />}
            title={programs.length === 0 ? "No cabin programs yet" : "No programs match your filters"}
            description={programs.length === 0 ? "Create one to define how cabin items are cut, across finishes." : undefined}
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead className="text-right">Outputs</TableHead>
                <TableHead className="text-right">Finishes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-[var(--muted)]" onClick={() => router.push(`/cabin-programs/${p.id}`)}>
                  <TableCell>
                    <span className={cn("inline-block h-2 w-2 rounded-full", p.audited ? "bg-[var(--success)]" : "bg-[var(--border-strong)]")} title={p.audited ? "Audited" : "Pending"} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.code ?? "—"}</TableCell>
                  <TableCell><div className="font-medium">{p.name}</div>{p.input_sheet_name && <div className="text-[11px] text-[var(--muted-foreground)]">{p.input_sheet_name}</div>}</TableCell>
                  <TableCell><Badge variant="purple">{p.category}</Badge></TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">{p.machine ? (MACHINE_LABEL[p.machine] ?? p.machine) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.output_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.finish_count}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => toggleAudit(p)} disabled={auditing.has(p.id)} title={p.audited ? "Mark pending" : "Mark audited"} className={cn("p-1 rounded cursor-pointer hover:bg-[var(--muted)]", p.audited ? "text-[var(--success)]" : "text-[var(--muted-foreground)]")}>
                        <Check size={15} />
                      </button>
                      <button type="button" onClick={() => openEdit(p.id)} title="Edit" className="p-1 rounded cursor-pointer text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                        <Pencil size={15} />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showForm && (
        <CabinProgramFormModal
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
