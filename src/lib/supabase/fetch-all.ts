/**
 * Fetch ALL rows of a PostgREST query without serial page-walking.
 *
 * The old pattern (`while … .range(off, off+999) … off += 1000`) costs one
 * full function→DB round-trip PER PAGE, in sequence — and with the serverless
 * function far from the DB that's ~300 ms per page. This helper asks for the
 * first page WITH an exact count, then fetches every remaining page in
 * parallel: total wall-clock ≈ 2 round-trips regardless of row count.
 *
 * `make` must return a FRESH builder on every call (PostgREST builders are
 * single-use): (from, to, withCount) => query ending in .range(from, to),
 * passing `{ count: "exact" }` to .select() only when `withCount` is true.
 */
export async function fetchAllRanged<T>(
  make: (
    from: number,
    to: number,
    withCount: boolean,
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
    count?: number | null;
  }>,
  page = 1000,
): Promise<T[]> {
  const first = await make(0, page - 1, true);
  if (first.error) throw first.error;
  const rows: T[] = [...(first.data ?? [])];
  // count is the filtered total; fall back to "stop when a page comes back
  // short" semantics if a backend ever omits it.
  const total = first.count ?? rows.length;
  if (rows.length < page || total <= page) return rows;

  const rest = await Promise.all(
    Array.from({ length: Math.ceil((total - page) / page) }, (_, i) =>
      make(page * (i + 1), page * (i + 2) - 1, false),
    ),
  );
  for (const r of rest) {
    if (r.error) throw r.error;
    rows.push(...(r.data ?? []));
  }
  return rows;
}
