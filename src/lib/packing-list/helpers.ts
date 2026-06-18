import { PACKING_SECTIONS } from "./packing-list-sections";
import type { CategoryNode } from "@/lib/actions/categories";

/** Key used to group any line whose section_key isn't a known register section. */
export const OTHER_SECTION_KEY = "other";

/**
 * Build a map of category_id → section_key. Each section's `categoryPaths`
 * claim that category + all its descendants. When more than one section could
 * claim a category (a parent section and a more specific child section both
 * match), the MOST SPECIFIC (deepest category root) wins; ties keep the first
 * in PACKING_SECTIONS order. Used at seed time to drop each BOM line into the
 * single best section.
 *
 * Plain (non-server) module so it can be shared by the server action and the
 * standalone bulk-seed script's mirror logic.
 */
export function buildCategorySectionMap(cats: CategoryNode[]): Map<string, string> {
  const byParent = new Map<string | null, CategoryNode[]>();
  for (const c of cats) {
    const arr = byParent.get(c.parent_id) ?? [];
    arr.push(c);
    byParent.set(c.parent_id, arr);
  }
  const resolvePath = (path: string): string | null => {
    const segs = path.split(">").map((s) => s.trim()).filter(Boolean);
    let parentId: string | null = null;
    let matched: CategoryNode | null = null;
    for (const seg of segs) {
      const sibs: CategoryNode[] = byParent.get(parentId) ?? [];
      const found: CategoryNode | undefined = sibs.find(
        (c: CategoryNode) => c.name.toLowerCase() === seg.toLowerCase(),
      );
      if (!found) return null;
      matched = found;
      parentId = found.id;
    }
    return matched?.id ?? null;
  };
  const descendants = (rootId: string): string[] => {
    const out = [rootId];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const ch of byParent.get(id) ?? []) {
        out.push(ch.id);
        stack.push(ch.id);
      }
    }
    return out;
  };

  const map = new Map<string, string>();
  const bestDepth = new Map<string, number>(); // category_id → claiming root depth
  for (const sec of PACKING_SECTIONS) {
    for (const path of sec.categoryPaths) {
      const rootId = resolvePath(path);
      if (!rootId) continue;
      const depth = path.split(">").filter((s) => s.trim()).length;
      for (const id of descendants(rootId)) {
        const prev = bestDepth.get(id);
        if (prev === undefined || depth > prev) {
          map.set(id, sec.key);
          bestDepth.set(id, depth);
        }
      }
    }
  }
  return map;
}
