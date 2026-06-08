/**
 * Import Car Linton cabin catalog (scripts/car-linton.json) into Supabase.
 * - Ensures door-type sub-categories (ACO/AT/MT/Collapsible) under "Car Linton".
 * - Inserts items (mechanical_finished_stock / stocked / make / UOM nos), code LINTON-NNN.
 * - Opening stock -> Main Store (inventory + inventory_transactions) for stock != 0.
 * - Idempotent: skips any item whose name already exists (active).
 */
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';
const MAIN_STORE = '0ebcfb80-19e2-43e7-b15c-e6020bd5506d';

async function supa(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: options.prefer || 'return=minimal', ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (options.prefer === 'return=representation' || !options.method || options.method === 'GET') return res.json();
  return null;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function main() {
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'car-linton.json'), 'utf8'));
  console.log(`Catalog items: ${items.length}`);

  const [cabin] = await supa('item_categories?name=eq.Cabin&parent_id=is.null&select=id&limit=1');
  if (!cabin) throw new Error('Cabin parent not found');
  const [cl] = await supa(`item_categories?name=eq.Car%20Linton&parent_id=eq.${cabin.id}&select=id&limit=1`);
  if (!cl) throw new Error('Car Linton type not found');
  console.log(`Car Linton type: ${cl.id}`);

  // Ensure a sub-category per distinct Category
  const cats = [...new Set(items.map((it) => it.category))];
  const subId = {};
  for (const c of cats) {
    const ex = await supa(`item_categories?name=eq.${encodeURIComponent(c)}&parent_id=eq.${cl.id}&select=id&limit=1`);
    if (ex.length) subId[c] = ex[0].id;
    else {
      const cr = await supa('item_categories', { method: 'POST', prefer: 'return=representation',
        body: JSON.stringify({ name: c, parent_id: cl.id, procurement_type: 'make' }) });
      subId[c] = cr[0].id;
      console.log(`  created sub-category ${c}`);
    }
  }

  const uoms = await supa('units_of_measurement?select=id,abbreviation');
  const nos = uoms.find((u) => String(u.abbreviation).toLowerCase() === 'nos') || uoms[0];

  const existing = new Set();
  for (let off = 0; ; off += 1000) {
    const b = await supa(`items?is_active=eq.true&select=name&limit=1000&offset=${off}`);
    b.forEach((r) => r.name && existing.add(r.name.toLowerCase().trim()));
    if (b.length < 1000) break;
  }
  const codes = await supa('items?code=ilike.LINTON-%25&select=code');
  let maxN = 0;
  codes.forEach((r) => { const m = /^LINTON-(\d+)$/i.exec(r.code); if (m) maxN = Math.max(maxN, +m[1]); });

  const toInsert = items.filter((it) => !existing.has(it.name.toLowerCase().trim()));
  console.log(`To insert: ${toInsert.length} | skipped (exists): ${items.length - toInsert.length} | starting LINTON-${maxN + 1}`);
  toInsert.forEach((it, i) => { it.code = `LINTON-${String(maxN + 1 + i).padStart(3, '0')}`; });

  const idByCode = new Map();
  let done = 0;
  for (const batch of chunk(toInsert, 200)) {
    const payload = batch.map((it) => ({
      code: it.code, name: it.name, lookup_key: it.name,
      item_type: 'mechanical_finished_stock', stock_behaviour: 'stocked', procurement_type: 'make',
      uom_id: nos.id, category_id: subId[it.category], is_active: true,
    }));
    const rep = await supa('items', { method: 'POST', prefer: 'return=representation', body: JSON.stringify(payload) });
    rep.forEach((r) => idByCode.set(r.code, r.id));
    done += rep.length;
    console.log(`  inserted ${done}/${toInsert.length}`);
  }

  const stocked = toInsert.filter((it) => Number(it.stock) !== 0 && idByCode.has(it.code));
  for (const batch of chunk(stocked, 200)) {
    await supa('inventory', { method: 'POST',
      body: JSON.stringify(batch.map((it) => ({ item_id: idByCode.get(it.code), warehouse_id: MAIN_STORE, quantity: it.stock }))) });
    await supa('inventory_transactions', { method: 'POST',
      body: JSON.stringify(batch.map((it) => ({ item_id: idByCode.get(it.code), warehouse_id: MAIN_STORE,
        transaction_type: 'adjustment', quantity: it.stock, notes: 'Opening stock (car linton import)', reference_type: 'import' }))) });
  }
  console.log(`Opening stock set for ${stocked.length} items`);
  console.log('DONE');
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
