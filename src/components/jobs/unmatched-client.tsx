"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  ArrowLeft, Search, Link2, Plus, Check, AlertTriangle, Package, Loader2,
} from "lucide-react";
import type { UnmatchedPattern, ItemOption } from "@/lib/actions/bom-mapping";
import {
  searchItemsForMapping,
  bulkMapBomLines,
  createItemAndMap,
} from "@/lib/actions/bom-mapping";

interface Props {
  initialPatterns: UnmatchedPattern[];
}

export function UnmatchedClient({ initialPatterns }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [patterns, setPatterns] = useState(initialPatterns);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  // Map modal state
  const [mapTarget, setMapTarget] = useState<UnmatchedPattern | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ItemOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create modal state
  const [createTarget, setCreateTarget] = useState<UnmatchedPattern | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCode, setNewItemCode] = useState("");
  const [newItemType, setNewItemType] = useState("raw_material");
  const [isCreating, setIsCreating] = useState(false);

  const totalUnmatched = patterns.reduce((sum, p) => sum + p.count, 0);
  const totalResolved = patterns
    .filter((p) => resolved.has(patternKey(p)))
    .reduce((sum, p) => sum + p.count, 0);

  function patternKey(p: UnmatchedPattern) {
    return `${p.category}||${p.variant}||${p.value_text}`;
  }

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchItemsForMapping(q);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  function onSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(q), 300);
  }

  // Open map modal
  function openMapModal(pattern: UnmatchedPattern) {
    setMapTarget(pattern);
    setSearchQuery("");
    setSearchResults([]);
    // Pre-fill search with a useful guess
    const hint = pattern.value_text || pattern.variant || pattern.category;
    if (hint) {
      setSearchQuery(hint);
      doSearch(hint);
    }
  }

  // Map to existing item
  async function handleMap(item: ItemOption) {
    if (!mapTarget || isMapping) return;
    setIsMapping(true);
    try {
      await bulkMapBomLines(
        mapTarget.category,
        mapTarget.variant,
        mapTarget.value_text,
        item.id,
      );
      setResolved((prev) => new Set(prev).add(patternKey(mapTarget)));
      setMapTarget(null);
      // Refresh data
      startTransition(() => router.refresh());
    } catch (err) {
      alert("Failed to map: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsMapping(false);
    }
  }

  // Open create modal
  function openCreateModal(pattern: UnmatchedPattern) {
    setCreateTarget(pattern);
    const suggestedName = pattern.value_text || pattern.variant || "";
    setNewItemName(suggestedName);
    // Generate a code from category + variant
    const prefix = (pattern.category || "ITEM").replace(/[^A-Za-z]/g, "").substring(0, 6).toUpperCase();
    const suffix = (pattern.variant || "001").replace(/[^A-Za-z0-9]/g, "").substring(0, 8).toUpperCase();
    setNewItemCode(`${prefix}-${suffix}`);
    setNewItemType("raw_material");
    setMapTarget(null);
  }

  // Create item and map
  async function handleCreate() {
    if (!createTarget || isCreating) return;
    if (!newItemName.trim() || !newItemCode.trim()) {
      alert("Name and Code are required");
      return;
    }
    setIsCreating(true);
    try {
      await createItemAndMap(
        {
          name: newItemName.trim(),
          code: newItemCode.trim(),
          lookup_key: newItemName.trim(),
          item_type: newItemType,
        },
        createTarget.category,
        createTarget.variant,
        createTarget.value_text,
      );
      setResolved((prev) => new Set(prev).add(patternKey(createTarget)));
      setCreateTarget(null);
      startTransition(() => router.refresh());
    } catch (err) {
      alert("Failed to create: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsCreating(false);
    }
  }

  const activePatterns = patterns.filter((p) => !resolved.has(patternKey(p)));

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/jobs"
          className="p-2 rounded-lg hover:bg-[var(--muted)] transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Unmatched BOM Items</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            BOM lines that need to be mapped to inventory items. Map once here and it applies across all jobs.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-sm text-[var(--muted-foreground)]">Unique Patterns</div>
          <div className="text-2xl font-bold mt-1">{activePatterns.length}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-sm text-[var(--muted-foreground)]">Total Unmatched Lines</div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{totalUnmatched - totalResolved}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-sm text-[var(--muted-foreground)]">Resolved This Session</div>
          <div className="text-2xl font-bold mt-1 text-green-600">{totalResolved}</div>
        </div>
      </div>

      {/* Table */}
      {activePatterns.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted-foreground)]">
          <Check size={48} className="mx-auto mb-4 text-green-500" />
          <p className="text-lg font-medium">All BOM items are mapped!</p>
          <p className="text-sm mt-1">Every BOM line is linked to an inventory item.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Value / Lookup Key</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Jobs</TableHead>
                <TableHead className="text-right w-[200px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activePatterns.map((p, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-[var(--muted)]">
                      {p.category}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {p.variant || <span className="text-[var(--muted-foreground)]">-</span>}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {p.value_text ? (
                      <span className="text-sm break-words">{p.value_text}</span>
                    ) : (
                      <span className="text-[var(--muted-foreground)] text-sm italic">
                        No value text
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className="text-amber-600 font-medium">{p.count}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {p.jobs_affected}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openMapModal(p)}
                      >
                        <Link2 size={14} className="mr-1" />
                        Map
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => openCreateModal(p)}
                      >
                        <Plus size={14} className="mr-1" />
                        Create
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Map to Existing Item Modal */}
      {mapTarget && (
        <Modal
          title="Map to Inventory Item"
          onClose={() => setMapTarget(null)}
          className="max-w-2xl"
        >
          <div className="space-y-4">
            {/* Pattern info */}
            <div className="bg-[var(--muted)] rounded-lg p-3 text-sm">
              <div className="flex gap-4">
                <div>
                  <span className="text-[var(--muted-foreground)]">Category:</span>{" "}
                  <strong>{mapTarget.category}</strong>
                </div>
                <div>
                  <span className="text-[var(--muted-foreground)]">Variant:</span>{" "}
                  <strong>{mapTarget.variant || "-"}</strong>
                </div>
              </div>
              {mapTarget.value_text && (
                <div className="mt-1">
                  <span className="text-[var(--muted-foreground)]">Lookup:</span>{" "}
                  <strong>{mapTarget.value_text}</strong>
                </div>
              )}
              <div className="mt-1 text-[var(--muted-foreground)]">
                This will update <strong className="text-[var(--foreground)]">{mapTarget.count}</strong> BOM
                lines across <strong className="text-[var(--foreground)]">{mapTarget.jobs_affected}</strong> jobs
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <Input
                placeholder="Search items by name, code, or lookup key..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="max-h-[360px] overflow-y-auto rounded border border-[var(--border)]">
              {isSearching ? (
                <div className="flex items-center justify-center py-8 text-[var(--muted-foreground)]">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-8 text-[var(--muted-foreground)] text-sm">
                  {searchQuery.length < 2
                    ? "Type at least 2 characters to search"
                    : "No items found"}
                  {searchQuery.length >= 2 && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openCreateModal(mapTarget)}
                      >
                        <Plus size={14} className="mr-1" />
                        Create New Item Instead
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      className="w-full text-left px-4 py-3 hover:bg-[var(--muted)] transition-colors flex items-center gap-3 disabled:opacity-50"
                      onClick={() => handleMap(item)}
                      disabled={isMapping}
                    >
                      <Package size={16} className="text-[var(--muted-foreground)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.name}</div>
                        <div className="text-xs text-[var(--muted-foreground)] flex gap-3 mt-0.5">
                          <span className="font-mono">{item.code}</span>
                          {item.category_name && <span>{item.category_name}</span>}
                          <span className="capitalize">{item.item_type.replace(/_/g, " ")}</span>
                        </div>
                        {item.lookup_key && item.lookup_key !== item.name && (
                          <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
                            Lookup: {item.lookup_key}
                          </div>
                        )}
                      </div>
                      {isMapping ? (
                        <Loader2 size={16} className="animate-spin shrink-0" />
                      ) : (
                        <Link2 size={16} className="text-[var(--muted-foreground)] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Create New Item Modal */}
      {createTarget && (
        <Modal
          title="Create Item & Map"
          onClose={() => setCreateTarget(null)}
          className="max-w-lg"
        >
          <div className="space-y-4">
            <div className="bg-[var(--muted)] rounded-lg p-3 text-sm">
              <span className="text-[var(--muted-foreground)]">Mapping:</span>{" "}
              <strong>{createTarget.category}</strong>
              {createTarget.variant && ` / ${createTarget.variant}`}
              {" "}<span className="text-[var(--muted-foreground)]">({createTarget.count} lines)</span>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Item Name</label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Enter item name"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Item Code</label>
              <Input
                value={newItemCode}
                onChange={(e) => setNewItemCode(e.target.value)}
                placeholder="e.g. CABIN-001"
                className="font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Item Type</label>
              <select
                value={newItemType}
                onChange={(e) => setNewItemType(e.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                <option value="raw_material">Raw Material</option>
                <option value="sub_assembly">Sub Assembly</option>
                <option value="finished_good">Finished Good</option>
                <option value="mechanical_finished_stock">Mechanical Finished Stock</option>
                <option value="door_panel">Door Panel</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => setCreateTarget(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isCreating || !newItemName.trim() || !newItemCode.trim()}
              >
                {isCreating ? (
                  <>
                    <Loader2 size={14} className="mr-1 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus size={14} className="mr-1" />
                    Create & Map {createTarget.count} Lines
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
