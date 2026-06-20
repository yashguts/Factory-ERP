/**
 * Runtime inventory resolver (ported from scripts/partlist-brain/resolve-inventory.js,
 * which backtested at 83%). Pure + in-memory: the blend engine fetches all active
 * items + categories once, builds a resolver, and resolves every line locally.
 *
 *   const r = buildResolver(items, categories);
 *   const hit = r.resolve(particular, sectionKey, spec); // -> { item } | { item:null, reason }
 */
import { packingSection } from "@/lib/packing-list/packing-list-sections";
import overridesRaw from "./partlist-overrides.json";

export interface ItemLite { id: string; code: string; name: string; category_id: string | null }
export interface CategoryLite { id: string; name: string; parent_id: string | null }
export interface ResolveHit { item: ItemLite | null; reason: string; cov?: number }

const STOP = new Set(["the", "for", "with", "and", "type", "nos", "no", "set", "pcs", "pc",
  "size", "of", "as", "per", "mm", "kg", "qty", "each", "new", "old", "sr"]);
const SHAPE = new Set(["l", "u", "c", "z", "t", "i", "h"]);

interface Tok { all: Set<string>; sizes: Set<string> }
function tokenize(s: string): Tok {
  const all = new Set<string>(), sizes = new Set<string>();
  for (let t of String(s || "").toLowerCase().replace(/[(),"']/g, " ").split(/[\s/]+/)) {
    t = t.replace(/[^a-z0-9.x+-]/g, "");
    if (!t || STOP.has(t)) continue;
    if (t.length < 2 && !SHAPE.has(t)) continue;
    // normalise the size unit: "350mm" -> "350" so a "350mm" spec matches a "350" SKU
    // (only when >=2 chars remain, to keep single-digit thicknesses like "8mm" intact)
    if (/[0-9]/.test(t)) { const sz = t.replace(/mm$/, ""); if (sz.length >= 2) t = sz; }
    // normalise side: part-list says "RHS"/"LHS", SKUs say "(RH)"/"(LH)" — pick the right side
    else if (t === "rhs") t = "rh"; else if (t === "lhs") t = "lh";
    all.add(t);
    if (/[0-9]/.test(t)) sizes.add(t);
  }
  return { all, sizes };
}

// Section -> corrected ERP category, from the research+grounding pass
// (partlist-overrides.json) plus a couple of hand-verified fixes. Lets particulars
// whose template category was empty/wrong resolve to the right inventory category.
interface Override { categoryPath?: string; nonInventory?: boolean; aliases?: string[] }
const OVERRIDES = overridesRaw as Record<string, Override>;
const CATEGORY_OVERRIDE: Record<string, string[]> = {
  "p-dade-weight-rod-ms": ["Header Systems > Dead Weight25x25"],
  "p-car-header-hanging-bkt": ["Header Systems > HEADER"],
};
for (const [sk, o] of Object.entries(OVERRIDES)) if (o.categoryPath) CATEGORY_OVERRIDE[sk] ??= [o.categoryPath];

export interface Resolver { resolve: (label: string, sectionKey: string | null, spec: string | null) => ResolveHit }

export function buildResolver(items: ItemLite[], cats: CategoryLite[]): Resolver {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c: CategoryLite): string => {
    const p: string[] = []; let cur: CategoryLite | undefined = c, g = 0;
    while (cur && g++ < 12) { p.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    return p.join(" > ");
  };
  const idByPath = new Map(cats.map((c) => [pathOf(c), c.id]));
  const childrenOf = new Map<string | null, string[]>();
  for (const c of cats) { const k = c.parent_id; if (!childrenOf.has(k)) childrenOf.set(k, []); childrenOf.get(k)!.push(c.id); }
  const descendants = (roots: string[]): Set<string> => {
    const out = new Set<string>(); const q = [...roots];
    while (q.length) { const id = q.shift()!; if (out.has(id)) continue; out.add(id); for (const ch of childrenOf.get(id) || []) q.push(ch); }
    return out;
  };

  const cabinRoot = cats.find((c) => c.name === "Cabin" && !c.parent_id);
  const cabinIds = cabinRoot ? descendants([cabinRoot.id]) : new Set<string>();

  interface ItemT extends ItemLite { tok: Tok }
  const itemsByCat = new Map<string, ItemT[]>();
  const globalItems: ItemT[] = [];
  for (const raw of items) {
    const it: ItemT = { ...raw, tok: tokenize(raw.name) };
    if (it.category_id) { if (!itemsByCat.has(it.category_id)) itemsByCat.set(it.category_id, []); itemsByCat.get(it.category_id)!.push(it); }
    if (!it.category_id || !cabinIds.has(it.category_id)) globalItems.push(it);
  }

  const candCache = new Map<string, ItemT[]>();
  const sizedCache = new Map<string, number>();
  function candidates(sectionKey: string | null): ItemT[] {
    const key = sectionKey || "(none)";
    if (candCache.has(key)) return candCache.get(key)!;
    const sec = sectionKey ? packingSection(sectionKey) : undefined;
    const paths = CATEGORY_OVERRIDE[key] || (sec ? sec.categoryPaths : []);
    let list: ItemT[];
    if (paths && paths.length) {
      const roots = paths.map((p) => idByPath.get(p)).filter(Boolean) as string[];
      const all = descendants(roots);
      const seen = new Set<string>(); list = [];
      for (const cid of all) for (const it of itemsByCat.get(cid) || []) if (!seen.has(it.id)) { seen.add(it.id); list.push(it); }
    } else list = globalItems;
    candCache.set(key, list);
    return list;
  }
  function sizedFrac(cands: ItemT[], key: string): number {
    if (sizedCache.has(key)) return sizedCache.get(key)!;
    const f = cands.length ? cands.filter((it) => it.tok.sizes.size > 0).length / cands.length : 0;
    sizedCache.set(key, f); return f;
  }

  function resolve(label: string, sectionKey: string | null, spec: string | null): ResolveHit {
    const key = sectionKey || "(none)";
    const cands = candidates(sectionKey);
    if (!cands.length) return { item: null, reason: "no-category" };
    const q = tokenize(`${label} ${spec || ""}`);
    if (!q.all.size) return cands.length === 1 ? { item: cands[0], reason: "sole-candidate" } : { item: null, reason: "no-spec" };
    const sizeArr = [...q.sizes], allArr = [...q.all];
    const sized = sizedFrac(cands, key) >= 0.5;

    let pool = cands, enforced = false;
    if (sizeArr.length && sized) {
      const subset = cands.filter((it) => it.tok.sizes.size > 0 && [...it.tok.sizes].every((t) => q.sizes.has(t)));
      if (subset.length) { pool = subset; enforced = true; }
      else {
        const exact = cands.filter((it) => sizeArr.every((t) => it.tok.all.has(t)));
        if (exact.length) { pool = exact; enforced = true; } else return { item: null, reason: "no-match" };
      }
    }
    let best: { it: ItemT; score: number; cov: number } | null = null;
    for (const it of pool) {
      const allHit = allArr.filter((t) => it.tok.all.has(t)).length;
      const cov = allHit / allArr.length;
      const sizeSpecificity = [...it.tok.sizes].filter((t) => q.sizes.has(t)).length;
      const extra = [...it.tok.sizes].filter((t) => !q.sizes.has(t)).length;
      const score = sizeSpecificity * 1.0 + cov * 0.5 - 0.05 * extra;
      if (!best || score > best.score) best = { it, score, cov };
    }
    if (!best) return { item: null, reason: "no-match" };
    if (enforced || best.cov >= 0.45) return { item: best.it, reason: "matched", cov: +best.cov.toFixed(2) };
    return { item: null, reason: "no-match" };
  }

  return { resolve };
}
