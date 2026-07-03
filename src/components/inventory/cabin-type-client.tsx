"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  readParam,
  readIntParam,
  hasNoListParams,
  useUrlListSync,
} from "@/lib/hooks/use-url-list-state";
import { ArrowLeft, Search, Container, Plus, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { CabinAddItemModal } from "@/components/inventory/cabin-add-item-modal";
import { InlineStockAdjust } from "@/components/inventory/inline-stock-adjust";
import { StockLedgerPopover } from "@/components/inventory/stock-ledger-popover";
import { getCabinTypeView } from "@/lib/actions/cabin-type-view";
import type { CabinTypeRow } from "@/lib/actions/cabin";
import { useRealtimeRefresh } from "@/lib/realtime/use-realtime-refresh";
import type { Warehouse } from "@/lib/supabase/types";

interface Props {
  typeId: string;
  typeName: string;
  subCategories: { id: string; name: string }[];
  /** First page of rows, rendered server-side for instant paint. */
  initialRows: CabinTypeRow[];
  /** Count matching the default (unfiltered) query. */
  initialTotal: number;
  /** In-stock count matching the default query. */
  initialInStock: number;
  /** Total items in this type, ignoring filters (the "of Y items" figure). */
  typeTotal: number;
  /** Warehouses for the inline stock-adjust widget. */
  warehouses: Warehouse[];
}

const PAGE_SIZE = 100;

type SortKey = "code" | "name" | "stock";
type SortDir = "asc" | "desc";
type StockFilter = "all" | "in_stock" | "zero";

const LIST_PARAM_KEYS = ["q", "sub", "stock", "sort", "dir", "page"] as const;

export function CabinTypeClient({
  typeId,
  typeName,
  subCategories,
  initialRows,
  initialTotal,
  initialInStock,
  typeTotal,
  warehouses,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Query state (drives the server fetch). Initialised from the URL so Back
  // from an item restores the exact same view.
  const sp = useSearchParams();
  const [search, setSearch] = useState(() => readParam(sp, "q", ""));
  const [debouncedSearch, setDebouncedSearch] = useState(() => readParam(sp, "q", ""));
  const [subFilter, setSubFilter] = useState<string>(() => readParam(sp, "sub", "all"));
  const [stockFilter, setStockFilter] = useState<StockFilter>(
    () => readParam(sp, "stock", "all", ["all", "in_stock", "zero"]) as StockFilter,
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    () => readParam(sp, "sort", "name", ["code", "name", "stock"]) as SortKey,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readParam(sp, "dir", "asc", ["asc", "desc"]) as SortDir,
  );
  const [page, setPage] = useState(() => readIntParam(sp, "page", 1));
  const [showAdd, setShowAdd] = useState(false);

  useUrlListSync(
    { q: debouncedSearch, sub: subFilter, stock: stockFilter, sort: sortKey, dir: sortDir, page },
    { q: "", sub: "all", stock: "all", sort: "name", dir: "asc", page: 1 },
  );

  // Server-provided page data.
  const [rows, setRows] = useState<CabinTypeRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [inStock, setInStock] = useState(initialInStock);

  // Debounce the search box → debouncedSearch (which the fetch watches).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever the filters/sort change — but not on mount, which
  // would clobber a page number restored from the URL.
  const filtersTouched = useRef(false);
  useEffect(() => {
    if (!filtersTouched.current) {
      filtersTouched.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch, subFilter, stockFilter, sortKey, sortDir]);

  // Fetch a page from the server for the current query. A monotonic request id
  // guards against a slow earlier response overwriting a newer one when the user
  // changes filters/search/page quickly. Doubles as the post-mutation reload.
  const reqId = useRef(0);
  const runQuery = useCallback(() => {
    const myId = ++reqId.current;
    startTransition(async () => {
      const res = await getCabinTypeView({
        typeId,
        search: debouncedSearch,
        sub: subFilter,
        stock: stockFilter,
        sort: sortKey,
        dir: sortDir,
        page,
        pageSize: PAGE_SIZE,
      });
      if (myId !== reqId.current) return; // a newer query superseded this one
      // Ran off the end (e.g. an item was removed, or a shrinking filter) — the
      // counts ride on rows, so an empty page would otherwise read as "0 items".
      // Snap back to page 1 (re-fetches via the effect below).
      if (res.rows.length === 0 && page > 1) {
        setPage(1);
        return;
      }
      setRows(res.rows);
      setTotal(res.total);
      setInStock(res.inStock);
    });
  }, [typeId, debouncedSearch, subFilter, stockFilter, sortKey, sortDir, page]);

  // Re-fetch when the query changes — but skip the very first run when the
  // view opened with default state, since initialRows already match the
  // default query. With URL-carried filters (Back / shared link), fetch now.
  const firstRun = useRef(hasNoListParams(sp, LIST_PARAM_KEYS));
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    runQuery();
  }, [runQuery]);

  // Live sync: re-fetch the current page when another user changes items/stock.
  useRealtimeRefresh(["items", "inventory"], runQuery);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ label, sortField, className }: { label: string; sortField: SortKey; className?: string }) => (
    <TableHead
      className={`cursor-pointer select-none hover:bg-[var(--muted)] transition-colors ${className ?? ""}`}
      onClick={() => handleSort(sortField)}
    >
      <span className={`inline-flex items-center gap-1 ${className?.includes("text-right") ? "justify-end w-full" : ""}`}>
        {label}
        <ArrowUpDown size={12} className={sortKey === sortField ? "text-[var(--primary)]" : "opacity-30"} />
      </span>
    </TableHead>
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <Link
        href="/cabin-inventory"
        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Cabin Inventory
      </Link>

      <PageHeader
        icon={<Container size={18} />}
        title={typeName}
        meta={
          <>
            {total.toLocaleString()} of {typeTotal.toLocaleString()} items ·{" "}
            {inStock.toLocaleString()} in stock
            {isPending ? " — loading…" : ""}
          </>
        }
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add item
          </Button>
        }
      />

      <Toolbar>
        <div className="relative w-full max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            size="sm"
            placeholder="Search code or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {subCategories.length > 0 && (
          <Select
            size="sm"
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            className="w-[200px]"
          >
            <option value="all">All sub-types</option>
            {subCategories.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          size="sm"
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as StockFilter)}
          className="w-[140px]"
        >
          <option value="all">All Stock</option>
          <option value="in_stock">In Stock</option>
          <option value="zero">Out of Stock</option>
        </Select>
        <ToolbarSpacer />
      </Toolbar>

      {rows.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<Container size={28} />}
            title={
              isPending
                ? "Loading…"
                : typeTotal === 0
                  ? "No items in this type yet"
                  : "No items match your filters"
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="dense">
            <TableHeader sticky>
              <TableRow>
                <SortHeader label="Code" sortField="code" />
                <SortHeader label="Name" sortField="name" />
                <TableHead>Sub-type</TableHead>
                <SortHeader label="Stock" sortField="stock" className="text-right" />
                <TableHead>Status</TableHead>
                <TableHead className="w-10 text-right">Adjust</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((it) => {
                const inStk = it.total_stock > 0;
                return (
                  <TableRow
                    key={it.id}
                    className="cursor-pointer hover:bg-[var(--muted)]"
                    onClick={() => router.push(`/inventory/${it.id}`)}
                  >
                    <TableCell className="font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                      <Link
                        href={`/inventory/${it.id}`}
                        className="text-[var(--primary)] hover:underline"
                        title="Open item — structure, parts list, programs"
                      >
                        {it.code}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell className="text-[var(--muted-foreground)]">
                      {it.sub_category ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-right font-medium tabular-nums"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StockLedgerPopover itemId={it.id}>
                        <span
                          className={`cursor-help underline decoration-dotted underline-offset-2 hover:text-[var(--primary)] ${
                            it.total_stock < 0 ? "text-[var(--destructive)]" : ""
                          }`}
                        >
                          {it.total_stock.toLocaleString()}
                        </span>
                      </StockLedgerPopover>{" "}
                      <span className="text-xs text-[var(--muted-foreground)]">{it.uom}</span>
                    </TableCell>
                    <TableCell>
                      {inStk ? (
                        <Badge variant="success">OK</Badge>
                      ) : (
                        <Badge variant="danger">Out</Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <InlineStockAdjust
                        item={{
                          id: it.id,
                          code: it.code,
                          name: it.name,
                          lookup_key: null,
                          uom: { id: "", abbreviation: it.uom },
                        }}
                        warehouses={warehouses}
                        onSuccess={runQuery}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-[var(--muted-foreground)]">
            Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="text-[var(--muted-foreground)] tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {showAdd && (
        <CabinAddItemModal
          typeId={typeId}
          typeName={typeName}
          subCategories={subCategories}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            // The modal already calls router.refresh() (re-runs the server
            // component → refreshes the cached first page + typeTotal). runQuery
            // additionally refreshes the live page the user is looking at (which
            // may be filtered/paged beyond the default first page).
            runQuery();
          }}
        />
      )}
    </div>
  );
}
