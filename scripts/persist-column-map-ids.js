/**
 * Persist item_ids into target_column_map for all static-lookup columns
 * (headers, collapsible doors, cabin items where items exist).
 * After this, the column_map itself carries the item_id — no runtime lookup needed.
 */

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';

async function supaFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=minimal',
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (options.prefer === 'return=representation' || (!options.method || options.method === 'GET')) {
    return res.json();
  }
  return null;
}

async function main() {
  console.log('Persisting item_ids into column_map...\n');

  // Load items
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key&limit=1000&offset=${offset}`);
    items.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Items: ${items.length}`);

  // Build lookup: exact key → item, and normalized key → item
  const byExact = new Map();
  const byNorm = new Map();
  for (const item of items) {
    if (!item.lookup_key) continue;
    byExact.set(item.lookup_key, item);
    byNorm.set(item.lookup_key.replace(/\s+/g, ' ').trim().toLowerCase(), item);
  }

  function findItem(key) {
    if (!key) return null;
    let item = byExact.get(key);
    if (item) return item;
    item = byNorm.get(key.replace(/\s+/g, ' ').trim().toLowerCase());
    return item || null;
  }

  // Load column_map entries without item_id that have a static lookup_key (no {mat})
  let colMap = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`target_column_map?item_id=is.null&select=id,column_index,item_lookup_key,category,notes&limit=1000&offset=${offset}`);
    colMap.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  const staticEntries = colMap.filter(c =>
    c.item_lookup_key &&
    !c.item_lookup_key.includes('{mat}') &&
    !c.notes?.includes('Spec-lookup')
  );

  console.log(`Column_map entries without item_id: ${colMap.length}`);
  console.log(`Static lookup entries to resolve: ${staticEntries.length}`);

  let updated = 0;
  let notFound = 0;

  for (const entry of staticEntries) {
    const item = findItem(entry.item_lookup_key);
    if (item) {
      await supaFetch(`target_column_map?id=eq.${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ item_id: item.id })
      });
      updated++;
    } else {
      // Try the (Fire) space variant: "CO 900mm (Fire)" → "CO 900mm(Fire)"
      const alt = entry.item_lookup_key.replace(/\s*\(Fire\)/, '(Fire)');
      const item2 = findItem(alt);
      if (item2) {
        await supaFetch(`target_column_map?id=eq.${entry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item2.id, item_lookup_key: item2.lookup_key })
        });
        updated++;
      } else {
        console.log(`  Not found: col=${entry.column_index} "${entry.item_lookup_key}" (${entry.category})`);
        notFound++;
      }
    }
  }

  console.log(`\nUpdated: ${updated}`);
  console.log(`Not found: ${notFound}`);

  // Final tally
  let finalAll = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`target_column_map?select=item_id,item_lookup_key,notes&limit=1000&offset=${offset}`);
    finalAll.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const finalWithId = finalAll.filter(c => c.item_id).length;
  const finalMat = finalAll.filter(c => !c.item_id && c.item_lookup_key?.includes('{mat}')).length;
  const finalSpec = finalAll.filter(c => c.notes?.includes('Spec-lookup')).length;
  const finalOther = finalAll.length - finalWithId - finalMat - finalSpec;

  console.log(`\nFinal column_map breakdown:`);
  console.log(`  Total: ${finalAll.length}`);
  console.log(`  With item_id (auto-resolve): ${finalWithId}`);
  console.log(`  {mat} placeholder (needs door_finish): ${finalMat}`);
  console.log(`  Spec-lookup (needs Trade/Prod map): ${finalSpec}`);
  console.log(`  Other unmatched: ${finalOther}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
