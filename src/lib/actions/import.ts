"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import type { ImportPreviewRow, ImportResult } from "@/lib/import/types";
import { currentOperatorName } from "@/lib/actions/inventory";

export async function validateImportData(rows: ImportPreviewRow[]): Promise<ImportPreviewRow[]> {
  const supabase = await createClient();

  const { data: existingItems } = await supabase
    .from("items")
    .select("code")
    .in(
      "code",
      rows.map((r) => r.code)
    );

  const existingCodes = new Set((existingItems ?? []).map((i) => i.code));

  return rows.map((row) => {
    if (existingCodes.has(row.code)) {
      return { ...row, status: "duplicate" as const, error: "Item code already exists" };
    }
    if (!row.code || !row.name) {
      return { ...row, status: "error" as const, error: "Missing code or name" };
    }
    return { ...row, status: "valid" as const };
  });
}

export async function executeImport(
  rows: ImportPreviewRow[],
  warehouseId: string
): Promise<ImportResult> {
  const supabase = await createClient();
  const validRows = rows.filter((r) => r.selected && r.status === "valid");
  const result: ImportResult = { total: validRows.length, created: 0, stock_set: 0, errors: [] };

  const { data: categories } = await supabase.from("item_categories").select("id, name, parent_id");
  const { data: units } = await supabase.from("units_of_measurement").select("id, abbreviation");

  const categoryMap = new Map<string, string>();
  for (const cat of categories ?? []) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
    if (cat.parent_id) {
      const parent = (categories ?? []).find((c) => c.id === cat.parent_id);
      if (parent) {
        categoryMap.set(`${parent.name.toLowerCase()}/${cat.name.toLowerCase()}`, cat.id);
      }
    }
  }

  const nosUnit = (units ?? []).find((u) => u.abbreviation === "nos");
  if (!nosUnit) {
    result.errors.push({ row: 0, message: "UOM 'nos' not found in database" });
    return result;
  }

  for (const row of validRows) {
    try {
      let categoryId: string | null = null;
      const subCatKey = `${row.category_name.toLowerCase()}/${row.sub_category_name.toLowerCase()}`;
      categoryId = categoryMap.get(subCatKey) || categoryMap.get(row.category_name.toLowerCase()) || null;

      if (!categoryId && row.sub_category_name) {
        const parentId = categoryMap.get(row.category_name.toLowerCase());
        if (parentId) {
          const { data: newCat } = await supabase
            .from("item_categories")
            .insert({ name: row.sub_category_name, parent_id: parentId, description: null })
            .select("id")
            .single();
          if (newCat) {
            categoryId = newCat.id;
            categoryMap.set(subCatKey, newCat.id);
          }
        }
      }

      const { data: item, error: itemErr } = await supabase
        .from("items")
        .insert({
          code: row.code,
          name: row.name,
          description: row.description || null,
          lookup_key: (row as any).lookup_key || null,
          item_type: row.item_type,
          category_id: categoryId,
          uom_id: nosUnit.id,
          minimum_stock: 0,
          reorder_point: 0,
          lead_time_days: 0,
          cost_price: 0,
          is_active: true,
        })
        .select("id")
        .single();

      if (itemErr) {
        result.errors.push({ row: row.row_number, message: itemErr.message });
        continue;
      }

      result.created++;

      if (row.current_stock > 0 && item) {
        const { error: invErr } = await supabase.from("inventory").insert({
          item_id: item.id,
          warehouse_id: warehouseId,
          quantity: row.current_stock,
        });

        if (invErr) {
          result.errors.push({ row: row.row_number, message: `Stock: ${invErr.message}` });
        } else {
          result.stock_set++;

          await supabase.from("inventory_transactions").insert({
            item_id: item.id,
            warehouse_id: warehouseId,
            transaction_type: "adjustment",
            quantity: row.current_stock,
            notes: "Initial stock from import",
            created_by_name: await currentOperatorName(),
          });
        }
      }
    } catch (e) {
      result.errors.push({
        row: row.row_number,
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  revalidateTag("items");
  revalidateTag("inventory-stock");
  return result;
}
