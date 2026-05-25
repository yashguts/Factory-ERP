import * as XLSX from "xlsx";
import { parseDoorPanels } from "../src/lib/import/templates/door-panels.ts";
import { parseFinishedStock } from "../src/lib/import/templates/finished-stock.ts";
import type { ParsedRow } from "../src/lib/import/types.ts";

const SUPABASE_URL = "https://qwzisnmueuqnzzokkpmn.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14";

const UOM_NOS_ID = "6433fb21-d865-4d1c-8181-6a43cb2b0efb";
const WAREHOUSE_MAIN = "0ebcfb80-19e2-43e7-b15c-e6020bd5506d";

async function supabasePost(table: string, body: any[], upsert = false) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
  if (upsert) headers["Prefer"] = "resolution=merge-duplicates";
  else headers["Prefer"] = "return=minimal";

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table} insert failed: ${res.status} ${text}`);
  }
}

async function getCategories(): Promise<Map<string, string>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/item_categories?select=id,name,parent_id`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const cats = await res.json();
  const map = new Map<string, string>();
  for (const cat of cats) {
    map.set(cat.name.toLowerCase(), cat.id);
    if (cat.parent_id) {
      const parent = cats.find((c: any) => c.id === cat.parent_id);
      if (parent) map.set(`${parent.name.toLowerCase()}/${cat.name.toLowerCase()}`, cat.id);
    }
  }
  return map;
}

async function createSubCategory(name: string, parentId: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/item_categories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({ name, parent_id: parentId, description: null }),
  });
  const [cat] = await res.json();
  return cat.id;
}

async function main() {
  const wb = XLSX.readFile("a_copy.xlsx");

  // Parse Door Panels
  const dpSheet = wb.Sheets["Door Pannel"];
  const dpRows: string[][] = XLSX.utils.sheet_to_json(dpSheet, { header: 1, defval: "" });
  const doorPanels = parseDoorPanels(dpRows);

  // Parse Finished Stock
  const fsSheet = wb.Sheets["Finished Stock"];
  const fsRows: string[][] = XLSX.utils.sheet_to_json(fsSheet, { header: 1, defval: "" });
  const finishedStock = parseFinishedStock(fsRows);

  const allItems = [...doorPanels, ...finishedStock];
  console.log(`Parsed: ${doorPanels.length} door panels + ${finishedStock.length} finished stock = ${allItems.length} total`);

  // Check for duplicate codes
  const codeCount = new Map<string, number>();
  for (const item of allItems) {
    codeCount.set(item.code, (codeCount.get(item.code) || 0) + 1);
  }
  const dupes = [...codeCount.entries()].filter(([, v]) => v > 1);
  if (dupes.length > 0) {
    console.log(`WARNING: ${dupes.length} duplicate codes found:`);
    for (const [code, count] of dupes) {
      console.log(`  ${code} (${count}x)`);
    }
  }

  // Deduplicate - keep first occurrence
  const seen = new Set<string>();
  const uniqueItems: ParsedRow[] = [];
  for (const item of allItems) {
    if (!seen.has(item.code)) {
      seen.add(item.code);
      uniqueItems.push(item);
    }
  }
  console.log(`Unique items to import: ${uniqueItems.length}`);

  // Get categories
  const categoryMap = await getCategories();

  // Resolve category IDs, creating sub-categories as needed
  const itemRecords: any[] = [];
  for (const row of uniqueItems) {
    const subCatKey = `${row.category_name.toLowerCase()}/${row.sub_category_name.toLowerCase()}`;
    let categoryId = categoryMap.get(subCatKey) || categoryMap.get(row.category_name.toLowerCase()) || null;

    if (!categoryId && row.sub_category_name) {
      const parentId = categoryMap.get(row.category_name.toLowerCase());
      if (parentId) {
        categoryId = await createSubCategory(row.sub_category_name, parentId);
        categoryMap.set(subCatKey, categoryId);
        console.log(`  Created sub-category: ${row.sub_category_name} under ${row.category_name}`);
      }
    }

    itemRecords.push({
      code: row.code,
      name: row.name,
      description: row.description || null,
      lookup_key: row.lookup_key || null,
      item_type: row.item_type,
      category_id: categoryId,
      uom_id: UOM_NOS_ID,
      minimum_stock: 0,
      reorder_point: 0,
      lead_time_days: 0,
      cost_price: 0,
      is_active: true,
    });
  }

  // Bulk insert items in batches of 200
  const BATCH = 200;
  for (let i = 0; i < itemRecords.length; i += BATCH) {
    const batch = itemRecords.slice(i, i + BATCH);
    await supabasePost("items", batch);
    console.log(`  Inserted items ${i + 1}-${i + batch.length}`);
  }

  // Get all inserted items back to set stock
  const itemsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/items?select=id,code&limit=5000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const dbItems = await itemsRes.json();
  const codeToId = new Map<string, string>();
  for (const item of dbItems) codeToId.set(item.code, item.id);

  // Set initial stock for items with stock > 0
  const stockRows = uniqueItems.filter((r) => r.current_stock > 0);
  console.log(`\nSetting stock for ${stockRows.length} items...`);

  const inventoryRecords: any[] = [];
  const txnRecords: any[] = [];

  for (const row of stockRows) {
    const itemId = codeToId.get(row.code);
    if (!itemId) continue;

    inventoryRecords.push({
      item_id: itemId,
      warehouse_id: WAREHOUSE_MAIN,
      quantity: row.current_stock,
    });

    txnRecords.push({
      item_id: itemId,
      warehouse_id: WAREHOUSE_MAIN,
      transaction_type: "adjustment",
      quantity: row.current_stock,
      notes: "Initial stock from import",
    });
  }

  for (let i = 0; i < inventoryRecords.length; i += BATCH) {
    const batch = inventoryRecords.slice(i, i + BATCH);
    await supabasePost("inventory", batch);
    console.log(`  Inserted inventory ${i + 1}-${i + batch.length}`);
  }

  for (let i = 0; i < txnRecords.length; i += BATCH) {
    const batch = txnRecords.slice(i, i + BATCH);
    await supabasePost("inventory_transactions", batch);
    console.log(`  Inserted transactions ${i + 1}-${i + batch.length}`);
  }

  console.log(`\nDone! ${uniqueItems.length} items, ${inventoryRecords.length} stock records, ${txnRecords.length} transactions.`);
}

main().catch(console.error);
