const XLSX = require('xlsx');

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';

async function supaFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': KEY,
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=minimal',
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (options.prefer === 'return=representation' || !options.method || options.method === 'GET') {
    return res.json();
  }
  return null;
}

async function main() {
  console.log('=== Recategorize Door Panel Items ===\n');

  // 1. Read Excel
  const wb = XLSX.readFile('C:\\Users\\yash_\\OneDrive\\Desktop\\Door Panel Category.xlsx');
  const ws = wb.Sheets['Sheet1'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const entries = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || !row[3]) continue;
    entries.push({ cat: row[0].trim(), sub: (row[1] || '').trim(), lookup: row[3].trim() });
  }
  console.log(`Excel: ${entries.length} items to recategorize`);

  // 2. Fetch all items
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key,category_id&limit=1000&offset=${offset}`);
    items = items.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const itemByKey = {};
  items.forEach(i => { itemByKey[i.lookup_key] = i; });
  console.log(`DB: ${items.length} items loaded`);

  // 3. Fetch existing categories
  const categories = await supaFetch('item_categories?select=id,name,parent_id');
  const catByNameParent = {};
  categories.forEach(c => {
    catByNameParent[`${c.name}|${c.parent_id || 'null'}`] = c;
  });
  console.log(`DB: ${categories.length} categories loaded`);

  const DOORS_ID = 'f8550320-d0c3-4315-9575-e05eefd6a922'; // "Doors" parent

  // 4. Determine which categories and sub-categories we need
  const catSubPairs = new Map(); // cat -> Set<sub>
  for (const e of entries) {
    if (!catSubPairs.has(e.cat)) catSubPairs.set(e.cat, new Set());
    if (e.sub) catSubPairs.get(e.cat).add(e.sub);
  }

  console.log('\nCategory structure to create:');
  for (const [cat, subs] of catSubPairs) {
    console.log(`  ${cat} (under Doors)`);
    for (const sub of subs) {
      console.log(`    └─ ${sub}`);
    }
  }

  // 5. Create parent categories (under Doors) if they don't exist
  const parentCatIds = {}; // catName -> id
  for (const catName of catSubPairs.keys()) {
    const existingKey = `${catName}|${DOORS_ID}`;
    if (catByNameParent[existingKey]) {
      parentCatIds[catName] = catByNameParent[existingKey].id;
      console.log(`\n✓ Category "${catName}" already exists`);
    } else {
      const [created] = await supaFetch('item_categories', {
        method: 'POST',
        body: JSON.stringify({ name: catName, parent_id: DOORS_ID }),
        prefer: 'return=representation'
      });
      parentCatIds[catName] = created.id;
      console.log(`\n+ Created category "${catName}" (${created.id})`);
    }
  }

  // 6. Create sub-categories under each parent
  // Re-fetch categories to include newly created ones
  const allCats = await supaFetch('item_categories?select=id,name,parent_id');
  const catByNameParent2 = {};
  allCats.forEach(c => { catByNameParent2[`${c.name}|${c.parent_id || 'null'}`] = c; });

  const subCatIds = {}; // "cat|sub" -> id
  for (const [catName, subs] of catSubPairs) {
    const parentId = parentCatIds[catName];
    for (const subName of subs) {
      const key = `${subName}|${parentId}`;
      if (catByNameParent2[key]) {
        subCatIds[`${catName}|${subName}`] = catByNameParent2[key].id;
        console.log(`  ✓ Sub-category "${subName}" already exists`);
      } else {
        const [created] = await supaFetch('item_categories', {
          method: 'POST',
          body: JSON.stringify({ name: subName, parent_id: parentId }),
          prefer: 'return=representation'
        });
        subCatIds[`${catName}|${subName}`] = created.id;
        console.log(`  + Created sub-category "${subName}" (${created.id})`);
      }
    }
  }

  // 7. Update items' category_id
  console.log('\nUpdating item categories...');
  let updated = 0, skipped = 0, notFound = 0;

  for (const e of entries) {
    const item = itemByKey[e.lookup];
    if (!item) {
      notFound++;
      continue;
    }

    const targetCatId = e.sub ? subCatIds[`${e.cat}|${e.sub}`] : parentCatIds[e.cat];
    if (!targetCatId) {
      console.log(`  ? No category ID for ${e.cat}|${e.sub}`);
      skipped++;
      continue;
    }

    if (item.category_id === targetCatId) {
      skipped++;
      continue;
    }

    await supaFetch(`items?id=eq.${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category_id: targetCatId })
    });
    updated++;
  }

  console.log(`\n=== Done ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Already correct: ${skipped}`);
  console.log(`Not found in DB: ${notFound}`);

  // 8. Check if old "Door Panels" category still has items
  const OLD_DOOR_PANELS_ID = '57cd141a-7a34-4b03-ad45-5af9805a1bff';
  const remaining = await supaFetch(`items?category_id=eq.${OLD_DOOR_PANELS_ID}&select=id&limit=5`);
  console.log(`\nItems still in old "Door Panels" category: ${remaining.length}${remaining.length > 0 ? '+' : ''}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
