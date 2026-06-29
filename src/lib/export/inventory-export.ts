// Shared formatters + column defs for the Inventory list export (Excel + PDF),
// so both paths render identical labels/status. Excel columns keep Stock/Cost
// numeric (so the sheet stays sortable/summable); the PDF helper formats its own
// strings but reuses the label functions below.

import type { InventoryRow } from "@/lib/actions/inventory";
import type { ItemType, DemandSource } from "@/lib/supabase/types";
import type { ExportColumn } from "@/lib/export/xlsx";

const TYPE_LABELS: Record<ItemType, string> = {
  raw_material: "Raw Material",
  sub_assembly: "Sub Assembly",
  finished_good: "Finished Good",
  mechanical_finished_stock: "Mech. Finished Stock",
  door_panel: "Door Panel",
  temporary: "Temporary",
};

export function inventoryTypeLabel(t: ItemType): string {
  return TYPE_LABELS[t] ?? t;
}

export function inventoryProcLabel(p: "make" | "trade" | null): string {
  return p === "make" ? "Make" : p === "trade" ? "Trade" : "";
}

export function inventoryDemandLabel(d: DemandSource): string {
  switch (d) {
    case "jobs":
      return "Jobs";
    case "formula":
      return "Formula";
    case "none":
      return "No link";
    case "tooling":
      return "Tooling";
    default:
      return "";
  }
}

/** Same precedence as the list's Status badge: Low wins over Out (a 0-stock item
 *  with a reorder point reads as "Low"), then Out, else OK. */
export function inventoryStatusLabel(r: InventoryRow): string {
  const isLow = r.total_stock <= r.reorder_point && r.reorder_point > 0;
  if (isLow) return "Low";
  if (r.total_stock === 0) return "Out";
  return "OK";
}

/** Columns for the Excel export. Stock/Cost are numeric so Excel can sort/sum. */
export const INVENTORY_EXPORT_COLUMNS: ExportColumn<InventoryRow>[] = [
  { header: "Code", field: "code" },
  { header: "Name", field: "name" },
  { header: "Type", field: (r) => inventoryTypeLabel(r.item_type) },
  { header: "Make/Trade", field: (r) => inventoryProcLabel(r.effective_procurement_type) },
  { header: "Demand", field: (r) => inventoryDemandLabel(r.demand_source) },
  { header: "Category", field: (r) => r.parent_category_name ?? r.category_name ?? "" },
  { header: "Sub-Category", field: (r) => (r.parent_category_name ? (r.category_name ?? "") : "") },
  { header: "Stock", field: (r) => r.total_stock },
  { header: "UOM", field: (r) => r.uom_abbreviation },
  { header: "Cost (₹)", field: (r) => (r.cost_price > 0 ? r.cost_price : "") },
  { header: "Status", field: (r) => inventoryStatusLabel(r) },
];
