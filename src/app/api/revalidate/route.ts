import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";

/**
 * On-demand cache revalidation.
 *
 * Bulk inventory re-orgs (re-categorising items, creating/renaming/moving
 * categories) are sometimes applied with raw SQL straight against the DB. That
 * path bypasses the `revalidateTag()` calls the normal server actions fire — so
 * the dashboard's cached reads (`getCategories` 300s, `getInventoryPage` 300s,
 * `getItemRefs` 3600s, …) keep serving the stale tree until their TTL lapses
 * (up to an hour for item detail). A browser refresh doesn't help: the cache is
 * server-side. Hitting this route busts those tags immediately.
 *
 *   GET /api/revalidate            → refresh the inventory set (categories, items, stock)
 *   GET /api/revalidate?tags=a,b   → refresh just those tags
 *
 * No auth — it exposes nothing, only forces a cache refresh (same posture as
 * the unauthenticated /api/diag latency probe).
 */
export const dynamic = "force-dynamic";

const DEFAULT_TAGS = ["categories", "items", "inventory-stock"];

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("tags");
  const tags = param
    ? param.split(",").map((t) => t.trim()).filter(Boolean)
    : DEFAULT_TAGS;

  for (const tag of tags) revalidateTag(tag);
  // Belt-and-suspenders for the full-route render cache of /inventory and its
  // nested detail pages.
  revalidatePath("/inventory", "layout");

  return NextResponse.json({
    ok: true,
    revalidated: tags,
    path: "/inventory (layout)",
    at: new Date().toISOString(),
  });
}
