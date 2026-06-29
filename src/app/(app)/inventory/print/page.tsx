import { createCacheClient } from '@/lib/supabase/cache-client'
import PrintButton from './PrintButton'

export const metadata = { title: 'Inventory Atlas' }

// ─── Types ───────────────────────────────────────────────────────────────────

type CatRow  = { id: string; name: string; parent_id: string | null }
type SlimItem = { id: string; code: string; name: string; item_type: string; category_id: string; in_r1: boolean }
type SubGroup = { id: string; name: string; items: SlimItem[]; r1: number }
type TopGroup = { id: string; name: string; subcats: SubGroup[]; total: number; r1: number; pct: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coverageColor(pct: number) {
  if (pct === 0)  return '#475569'
  if (pct < 20)   return '#ef4444'
  if (pct < 40)   return '#f97316'
  if (pct < 60)   return '#eab308'
  if (pct < 80)   return '#3b82f6'
  return '#22c55e'
}

function coverageLabel(pct: number) {
  if (pct === 0)  return 'Unmapped'
  if (pct < 20)   return 'Sparse'
  if (pct < 40)   return 'Partial'
  if (pct < 60)   return 'Moderate'
  if (pct < 80)   return 'Good'
  return 'Excellent'
}

// Donut ring using CSS conic-gradient — pure server JSX, no hooks
function Donut({ pct, size = 68 }: { pct: number; size?: number }) {
  const color = coverageColor(pct)
  const inner = size - 18
  return (
    <div
      style={{
        background: `conic-gradient(${color} ${pct}%, #1e293b ${pct}%)`,
        borderRadius: '50%',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: '#0f172a',
          borderRadius: '50%',
          width: inner,
          height: inner,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: Math.max(9, size / 6.5), fontWeight: 700, color, lineHeight: 1 }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchAtlasData() {
  const sb = createCacheClient()

  // All categories (533 rows — tiny)
  const { data: cats } = await sb.from('item_categories').select('id, name, parent_id')
  const allCats: CatRow[] = cats ?? []
  const catMap = new Map(allCats.map(c => [c.id, c]))

  // Build cabin subtree to exclude
  const cabinRoot = allCats.find(c => c.name === 'Cabin' && c.parent_id === null)
  const cabinIds = new Set<string>()
  if (cabinRoot) {
    const queue = [cabinRoot.id]
    while (queue.length) {
      const id = queue.shift()!
      cabinIds.add(id)
      allCats.filter(c => c.parent_id === id).forEach(c => queue.push(c.id))
    }
  }

  // R1 unique items — parallel fetch across packing_r1_lines
  const r1Set = new Set<string>()
  {
    const { count } = await sb.from('packing_r1_lines')
      .select('item_id', { count: 'exact', head: true })
      .not('item_id', 'is', null)
    const pages = Math.ceil((count ?? 0) / 1000)
    const results = await Promise.all(
      Array.from({ length: Math.max(1, pages) }, (_, i) =>
        sb.from('packing_r1_lines').select('item_id')
          .not('item_id', 'is', null)
          .range(i * 1000, (i + 1) * 1000 - 1)
      )
    )
    results.flatMap(r => r.data ?? []).forEach(r => { if (r.item_id) r1Set.add(r.item_id) })
  }

  // Non-cabin active items — 10 parallel pages (handles up to 10k items)
  const cabinFilter = cabinIds.size > 0 ? `(${[...cabinIds].join(',')})` : null
  const itemPages = await Promise.all(
    Array.from({ length: 10 }, (_, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = sb.from('items')
        .select('id, code, name, item_type, category_id')
        .eq('is_active', true)
        .not('category_id', 'is', null)
        .range(i * 1000, (i + 1) * 1000 - 1)
        .order('name')
      if (cabinFilter) q = q.not('category_id', 'in', cabinFilter)
      return q
    })
  )

  const allItems: SlimItem[] = itemPages
    .flatMap(p => p.data ?? [])
    .map(i => ({ ...i, in_r1: r1Set.has(i.id) }))

  // Group: root category → sub-category → items
  const topMap = new Map<string, TopGroup>()

  for (const item of allItems) {
    const cat = catMap.get(item.category_id)
    if (!cat) continue

    // Walk up to root
    let cur = cat
    while (cur.parent_id) {
      const p = catMap.get(cur.parent_id)
      if (!p) break
      cur = p
    }

    if (!topMap.has(cur.id)) {
      topMap.set(cur.id, { id: cur.id, name: cur.name, subcats: [], total: 0, r1: 0, pct: 0 })
    }
    const top = topMap.get(cur.id)!
    top.total++
    if (item.in_r1) top.r1++

    let sub = top.subcats.find(s => s.id === cat.id)
    if (!sub) {
      sub = { id: cat.id, name: cat.name, items: [], r1: 0 }
      top.subcats.push(sub)
    }
    sub.items.push(item)
    if (item.in_r1) sub.r1++
  }

  const topGroups: TopGroup[] = Array.from(topMap.values()).map(g => ({
    ...g,
    pct: g.total > 0 ? Math.round(g.r1 * 100 / g.total) : 0,
  }))
  topGroups.sort((a, b) => b.total - a.total)
  for (const g of topGroups) {
    g.subcats.sort((a, b) => a.name.localeCompare(b.name))
    for (const sc of g.subcats) sc.items.sort((a, b) => a.name.localeCompare(b.name))
  }

  const totalItems = allItems.length
  const totalR1   = allItems.filter(i => i.in_r1).length

  return { topGroups, totalItems, totalR1 }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function InventoryAtlasPage() {
  const { topGroups, totalItems, totalR1 } = await fetchAtlasData()
  const overallPct = totalItems > 0 ? Math.round(totalR1 * 100 / totalItems) : 0
  const printDate  = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <>
      {/* ─── Styles ──────────────────────────────────────────────────────── */}
      <style>{`
        /* Print: hide app chrome, show document */
        @media print {
          aside { display: none !important; }
          main  { padding: 0 !important; flex: none !important; width: 100% !important; }
          .no-print  { display: none !important; }
          .print-only { display: block !important; }
          .print-break { page-break-before: always; break-before: page; }

          body { background: white !important; color: #111 !important; }

          .cat-banner {
            background: none !important;
            border-left: 4pt solid;
            padding: 5pt 0 5pt 10pt !important;
            border-radius: 0 !important;
            margin-bottom: 6pt !important;
          }
          .cat-banner-title { color: #111 !important; font-size: 14pt !important; }
          .cat-banner-meta  { color: #6b7280 !important; font-size: 9pt !important; }
          .subcat-hdr { color: #374151 !important; border-color: #d1d5db !important; }
          .item-row   { border-color: #e5e7eb !important; }
          .item-code  { color: #6b7280 !important; }
          .item-name  { color: #111 !important; }
          .dot-yes { color: #15803d !important; }
          .dot-no  { color: #9ca3af !important; }

          /* Two-column item grid for print */
          .item-grid { grid-template-columns: 1fr 1fr !important; column-gap: 18pt !important; }
          .item-row  { font-size: 8.5pt !important; padding: 2pt 0 !important; }
          .item-code { font-size: 8pt !important; }

          /* Cover table */
          .cover-table { width: 100%; border-collapse: collapse; margin-top: 10pt; font-size: 9pt; }
          .cover-table th, .cover-table td { border: 0.5pt solid #d1d5db; padding: 3.5pt 6pt; }
          .cover-table th { background: #f9fafb; font-weight: 600; }
          .bar-bg   { background: #e5e7eb; height: 7pt; border-radius: 3pt; overflow: hidden; width: 100%; }
          .bar-fill { height: 7pt; border-radius: 3pt; }
          .donut-print { display: none !important; } /* hide donuts in print — covered by table */
        }

        @media screen {
          .print-only { display: none; }
          .atlas-hero {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%);
            border-bottom: 1px solid #1e293b;
          }
          .atlas-card {
            background: #1e293b;
            border-radius: 12px;
            cursor: pointer;
            transition: transform 0.12s ease, box-shadow 0.12s ease;
          }
          .atlas-card:hover { transform: translateY(-2px); box-shadow: 0 10px 36px rgba(0,0,0,0.45); }
          .dot-yes { color: #22c55e; }
          .dot-no  { color: #334155; }
          .item-name { color: #cbd5e1; }
          .item-code { color: #475569; }
          .cat-banner-title { color: #f1f5f9; }
          .cat-banner-meta  { color: #94a3b8; }
          .subcat-hdr { color: #64748b; border-color: #1e293b; }
          .item-row   { border-color: #1e293b; }
        }
      `}</style>

      {/* ─── Screen: Hero header ──────────────────────────────────────────── */}
      <div className="atlas-hero no-print -mx-6 -mt-5 px-6 py-5 mb-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Inventory Atlas</h1>
            <p className="text-slate-400 text-sm mt-1">
              <span className="text-white font-semibold">{totalItems.toLocaleString()}</span> items across{' '}
              <span className="text-white font-semibold">{topGroups.length}</span> categories ·{' '}
              <span style={{ color: coverageColor(overallPct), fontWeight: 600 }}>{totalR1} in R1</span>
              {' '}({overallPct}% covered) · Cabin excluded
            </p>
          </div>
          <PrintButton />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-xs text-slate-500">
          {[0, 10, 30, 50, 70, 90].map(pct => (
            <span key={pct} className="flex items-center gap-1.5">
              <span style={{ background: coverageColor(pct), width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
              {coverageLabel(pct)}
            </span>
          ))}
          <span className="flex items-center gap-1.5 ml-4">
            <span className="dot-yes text-sm">●</span> In R1 packing list
          </span>
          <span className="flex items-center gap-1.5">
            <span className="dot-no text-sm">○</span> Not in R1
          </span>
        </div>
      </div>

      {/* ─── Print: Cover page ────────────────────────────────────────────── */}
      <div className="print-only" style={{ padding: '16pt 20pt' }}>
        <div style={{ borderBottom: '2pt solid #111', paddingBottom: '8pt', marginBottom: '4pt' }}>
          <div style={{ fontSize: '22pt', fontWeight: 700 }}>Inventory Atlas</div>
          <div style={{ fontSize: '9pt', color: '#6b7280', marginTop: '3pt' }}>
            {totalItems.toLocaleString()} items · {totalR1} in R1 ({overallPct}% coverage) · {printDate}
          </div>
          <div style={{ fontSize: '8pt', color: '#9ca3af', marginTop: '2pt' }}>
            ● = Item appears in Packing R1 template &nbsp;·&nbsp; ○ = Not referenced &nbsp;·&nbsp; Cabin inventory excluded
          </div>
        </div>
        <table className="cover-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left', width: '38%' }}>Category</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>In R1</th>
              <th style={{ textAlign: 'right' }}>%</th>
              <th style={{ textAlign: 'left', width: '30%' }}>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {topGroups.map(g => (
              <tr key={g.id}>
                <td style={{ fontWeight: 500 }}>{g.name}</td>
                <td style={{ textAlign: 'right' }}>{g.total}</td>
                <td style={{ textAlign: 'right' }}>{g.r1}</td>
                <td style={{ textAlign: 'right', color: coverageColor(g.pct), fontWeight: 600 }}>{g.pct}%</td>
                <td>
                  <div className="bar-bg">
                    <div className="bar-fill" style={{ width: `${g.pct}%`, background: coverageColor(g.pct) }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Screen: Category card grid ───────────────────────────────────── */}
      <div className="no-print mb-8">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Category Coverage — click to jump
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 10 }}>
          {topGroups.map(g => {
            const c = coverageColor(g.pct)
            return (
              <a key={g.id} href={`#cat-${g.id}`} style={{ textDecoration: 'none' }}>
                <div
                  className="atlas-card"
                  style={{ border: `1px solid ${c}28`, borderLeftWidth: 3, borderLeftColor: c, padding: '12px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Donut pct={g.pct} size={56} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.35, wordBreak: 'break-word' }}>
                        {g.name}
                      </div>
                      <div style={{ fontSize: 10, color: c, marginTop: 2 }}>{coverageLabel(g.pct)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#64748b' }}>{g.total.toLocaleString()}</span>
                    <span style={{ color: c, fontWeight: 600 }}>{g.r1} R1</span>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      </div>

      {/* ─── Item index (screen + print, page-break per category) ─────────── */}
      <div>
        <p className="no-print text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 pt-2 border-t border-slate-800">
          Full Item Index
        </p>

        {topGroups.map((g, gi) => {
          const c = coverageColor(g.pct)
          // Collapse subcat header when category has no real sub-division
          const hideSubcatHeader = g.subcats.length === 1 && g.subcats[0].name === g.name

          return (
            <div key={g.id} id={`cat-${g.id}`} className={gi > 0 ? 'print-break' : ''} style={{ marginBottom: 32 }}>

              {/* Category banner */}
              <div
                className="cat-banner"
                style={{
                  background: `linear-gradient(90deg, ${c}1a 0%, transparent 70%)`,
                  borderLeft: `4px solid ${c}`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                  gap: 12,
                }}
              >
                <div>
                  <span className="cat-banner-title" style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.2 }}>
                    {g.name}
                  </span>
                  <span className="cat-banner-meta" style={{ marginLeft: 10, fontSize: 12 }}>
                    {g.total} items · {g.r1} in R1 · {g.pct}% — {coverageLabel(g.pct)}
                  </span>
                </div>
                <div className="donut-print">
                  <Donut pct={g.pct} size={48} />
                </div>
                {/* Screen-only donut in banner */}
                <div className="no-print">
                  <Donut pct={g.pct} size={48} />
                </div>
              </div>

              {/* Subcategories */}
              {g.subcats.map(sc => (
                <div key={sc.id} style={{ marginBottom: 14 }}>
                  {!hideSubcatHeader && (
                    <div
                      className="subcat-hdr"
                      style={{ fontSize: 11, fontWeight: 600, paddingBottom: 5, borderBottom: '1px solid', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span>{sc.name}</span>
                      <span style={{ fontWeight: 400, opacity: 0.7 }}>
                        {sc.items.length} · {sc.r1} R1
                      </span>
                    </div>
                  )}

                  {/* Item grid — 2 columns */}
                  <div
                    className="item-grid"
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}
                  >
                    {sc.items.map(item => (
                      <div
                        key={item.id}
                        className="item-row"
                        style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '4px 0', borderBottom: '1px solid', fontSize: 12 }}
                      >
                        <span
                          className={item.in_r1 ? 'dot-yes' : 'dot-no'}
                          style={{ fontSize: 9, flexShrink: 0, fontWeight: 900 }}
                          title={item.in_r1 ? 'In R1 packing list' : 'Not in R1'}
                        >
                          {item.in_r1 ? '●' : '○'}
                        </span>
                        <span
                          className="item-code"
                          style={{ fontFamily: 'monospace', fontSize: 10, flexShrink: 0 }}
                        >
                          {item.code}
                        </span>
                        <span
                          className="item-name"
                          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                        >
                          {item.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
