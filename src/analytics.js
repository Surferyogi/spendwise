// Pure, data-driven analytics. Every insight is computed from the user's own
// transactions — nothing is estimated or invented. If something cannot be
// computed from the data, it is simply not shown.
import { toSGD } from './fx.js'

export const CATEGORIES = [
  'AI Services',
  'Travel & Flights',
  'Transport',
  'Telecom & Internet',
  'Software & Apps',
  'Shopping',
  'Golf',
  'Entertainment',
  'Food Delivery',
  'Health & Wellness',
  'Insurance',
  'Other',
]

// Fixed chip colors (identity is always carried by the visible label too).
export const CAT_COLORS = {
  'AI Services': 'var(--series-1)',
  'Travel & Flights': 'var(--series-2)',
  Transport: 'var(--series-3)',
  'Telecom & Internet': 'var(--series-4)',
  'Software & Apps': 'var(--series-5)',
  Shopping: 'var(--series-6)',
  Golf: 'var(--series-7)',
  Entertainment: 'var(--series-8)',
  'Food Delivery': 'var(--muted)',
  'Health & Wellness': 'var(--muted)',
  Insurance: 'var(--muted)',
  Other: 'var(--muted)',
}

export const monthKey = (d) => d.slice(0, 7)

export function fmtSGD(n, digits = 2) {
  if (n == null) return '—'
  return 'S$' + n.toLocaleString('en-SG', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtOrig(amount, currency) {
  const zeroDec = currency === 'JPY' || currency === 'KRW'
  return (
    currency +
    ' ' +
    Number(amount).toLocaleString('en-SG', {
      minimumFractionDigits: zeroDec ? 0 : 2,
      maximumFractionDigits: zeroDec ? 0 : 2,
    })
  )
}

// Enrich each txn with its SGD value at its own date's ECB rate.
export function enrich(txns, rates) {
  return txns.map((t) => {
    const { sgd, basis } = toSGD(t, rates)
    return { ...t, sgd, basis }
  })
}

export function byMonth(enriched) {
  const map = new Map()
  for (const t of enriched) {
    const k = monthKey(t.txn_date)
    if (!map.has(k)) map.set(k, { month: k, total: 0, unconverted: [], cats: {}, count: 0 })
    const m = map.get(k)
    m.count++
    if (t.sgd != null) {
      m.total += t.sgd
      m.cats[t.category] = (m.cats[t.category] || 0) + t.sgd
    } else {
      m.unconverted.push(t)
    }
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export function sumBy(enriched, keyFn) {
  const map = new Map()
  for (const t of enriched) {
    if (t.sgd == null) continue
    const k = keyFn(t)
    map.set(k, (map.get(k) || 0) + t.sgd)
  }
  return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
}

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const DAY = 86400000

// Recurring detection: merchants with >= 3 charges whose median gap is
// 6-8d (weekly), 25-35d (monthly), 80-100d (quarterly), 330-400d (annual);
// plus single-charge merchants whose description says "annual".
export function detectRecurring(enriched, today = new Date()) {
  const byMerchant = new Map()
  for (const t of enriched) {
    if (!byMerchant.has(t.merchant)) byMerchant.set(t.merchant, [])
    byMerchant.get(t.merchant).push(t)
  }
  const out = []
  for (const [merchant, list] of byMerchant) {
    const sorted = [...list].sort((a, b) => a.txn_date.localeCompare(b.txn_date))
    const explicitAnnual = sorted.some((t) => /annual/i.test(t.description || ''))
    if (sorted.length < 3 && !explicitAnnual) continue
    const gaps = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((new Date(sorted[i].txn_date) - new Date(sorted[i - 1].txn_date)) / DAY)
    }
    const med = median(gaps)
    let cadence = null
    if (med != null) {
      if (med >= 6 && med <= 8.5) cadence = 'weekly'
      else if (med >= 25 && med <= 35) cadence = 'monthly'
      else if (med >= 80 && med <= 100) cadence = 'quarterly'
      else if (med >= 330 && med <= 400) cadence = 'annual'
    }
    if (!cadence && explicitAnnual) cadence = 'annual (stated)'
    if (!cadence) continue
    const withSgd = sorted.filter((t) => t.sgd != null)
    const perCharge = withSgd.length ? withSgd.reduce((s, t) => s + t.sgd, 0) / withSgd.length : null
    const chargesPerMonth =
      cadence === 'weekly' ? 30.44 / 7 : cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 1 / 3 : 1 / 12
    const last = sorted[sorted.length - 1]
    // payment-method change: compare the latest stated method with the previous distinct stated method
    const methods = sorted.map((t) => t.payment_method).filter(Boolean)
    let methodChange = null
    if (methods.length >= 2) {
      const lastMethod = methods[methods.length - 1]
      const prevDistinct = [...methods.slice(0, -1)].reverse().find((m) => m !== lastMethod)
      if (prevDistinct) methodChange = { from: prevDistinct, to: lastMethod }
    }
    const lastAmt = last.sgd
    const prevAmts = withSgd.slice(0, -1).map((t) => t.sgd)
    const prevTypical = median(prevAmts)
    const priceChange =
      lastAmt != null && prevTypical != null && Math.abs(lastAmt - prevTypical) / prevTypical > 0.02
        ? { from: prevTypical, to: lastAmt }
        : null
    const daysSince = (today - new Date(last.txn_date)) / DAY
    const staleAfter = cadence === 'weekly' ? 21 : cadence.startsWith('annual') ? 430 : cadence === 'quarterly' ? 130 : 50
    out.push({
      merchant,
      category: last.category,
      cadence,
      count: sorted.length,
      perCharge,
      monthly: perCharge != null ? perCharge * chargesPerMonth : null,
      annualized: perCharge != null ? perCharge * chargesPerMonth * 12 : null,
      lastDate: last.txn_date,
      lastAmt,
      priceChange,
      methodChange,
      lastMethod: methods.length ? methods[methods.length - 1] : null,
      lapsed: daysSince > staleAfter,
      txns: sorted,
    })
  }
  return out.sort((a, b) => (b.annualized || 0) - (a.annualized || 0))
}

// Possible duplicates: same merchant + same original amount + within 1 day.
export function findDuplicates(enriched) {
  const flagged = []
  const seen = new Map()
  for (const t of [...enriched].sort((a, b) => a.txn_date.localeCompare(b.txn_date))) {
    const k = `${t.merchant}|${t.currency}|${Number(t.amount).toFixed(2)}`
    if (seen.has(k)) {
      const prev = seen.get(k)
      const gap = (new Date(t.txn_date) - new Date(prev.txn_date)) / DAY
      if (gap <= 1) flagged.push({ a: prev, b: t })
    }
    seen.set(k, t)
  }
  return flagged
}

// Insights: each one is computed and cites its numbers.
export function buildInsights(enriched, months, recurring, duplicates, openMissing = 0) {
  const insights = []
  if (openMissing > 0) {
    insights.push({
      level: 'warn',
      head: `${openMissing} email(s) contain charges this app cannot read`,
      body: 'PDF-attachment invoices, statements behind logins, etc. — so totals here UNDERSTATE real spending. See the Missing tab; sending those PDFs/screenshots to Claude closes the gap.',
    })
  }
  for (const r of recurring.filter((x) => x.methodChange).slice(0, 4)) {
    insights.push({
      level: 'info',
      head: `${r.merchant}: payment method changed — ${r.methodChange.from} → ${r.methodChange.to}`,
      body: 'Detected from the receipts themselves. If this wasn’t you, check the account.',
    })
  }
  const completed = months.filter((m) => m.month < new Date().toISOString().slice(0, 7))
  const cur = months.find((m) => m.month === new Date().toISOString().slice(0, 7))
  const lastM = completed[completed.length - 1]
  const prevM = completed[completed.length - 2]

  if (lastM && prevM && prevM.total > 0) {
    const pct = ((lastM.total - prevM.total) / prevM.total) * 100
    insights.push({
      level: pct > 15 ? 'warn' : pct < -10 ? 'good' : 'info',
      head: `${lastM.month}: ${fmtSGD(lastM.total)} total — ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs ${prevM.month} (${fmtSGD(prevM.total)})`,
      body: 'Converted totals; transactions without an FX rate are excluded and listed separately.',
    })
    // category movers
    const movers = []
    for (const c of new Set([...Object.keys(lastM.cats), ...Object.keys(prevM.cats)])) {
      const d = (lastM.cats[c] || 0) - (prevM.cats[c] || 0)
      if (Math.abs(d) >= 50) movers.push({ c, d, from: prevM.cats[c] || 0, to: lastM.cats[c] || 0 })
    }
    movers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    for (const m of movers.slice(0, 3)) {
      insights.push({
        level: m.d > 0 ? 'warn' : 'good',
        head: `${m.c}: ${m.d > 0 ? '+' : ''}${fmtSGD(m.d)} month-on-month`,
        body: `${fmtSGD(m.from)} in ${prevM.month} → ${fmtSGD(m.to)} in ${lastM.month}.`,
      })
    }
  }

  // current-month run rate vs last completed month
  if (cur && lastM && lastM.total > 0) {
    const dayOfMonth = new Date().getDate()
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    const projected = (cur.total / dayOfMonth) * daysInMonth
    if (projected > lastM.total * 1.25) {
      insights.push({
        level: 'crit',
        head: `This month is trending ${fmtSGD(projected)} (projected) vs ${fmtSGD(lastM.total)} last month`,
        body: `${fmtSGD(cur.total)} spent in the first ${dayOfMonth} day(s). Straight-line projection — check the biggest categories below.`,
      })
    }
  }

  for (const r of recurring.filter((r) => r.priceChange && !r.lapsed).slice(0, 4)) {
    insights.push({
      level: 'warn',
      head: `${r.merchant}: price changed ${fmtSGD(r.priceChange.from)} → ${fmtSGD(r.priceChange.to)}`,
      body: `Recurring ${r.cadence}. Worth checking whether the new price is expected.`,
    })
  }

  for (const d of duplicates.slice(0, 4)) {
    insights.push({
      level: 'warn',
      head: `Possible duplicate: ${d.a.merchant} — ${fmtOrig(d.a.amount, d.a.currency)} twice (${d.a.txn_date} & ${d.b.txn_date})`,
      body: 'If both charges are legitimate (e.g. two tickets), ignore this. Otherwise dispute one.',
    })
  }

  const activeRec = recurring.filter((r) => !r.lapsed && r.annualized != null)
  const recTotal = activeRec.reduce((s, r) => s + r.annualized, 0)
  if (activeRec.length) {
    insights.push({
      level: 'info',
      head: `${activeRec.length} active recurring charges ≈ ${fmtSGD(recTotal)} / year`,
      body: 'See the Recurring tab — cancelling or downgrading the top items is usually the fastest durable saving.',
    })
  }
  for (const r of recurring.filter((r) => r.lapsed).slice(0, 3)) {
    insights.push({
      level: 'good',
      head: `${r.merchant} looks lapsed — last charge ${r.lastDate}`,
      body: `Was ${r.cadence} at ~${fmtSGD(r.perCharge)} per charge. If you cancelled it, that saving is already banked; if not, check whether it moved to another payment method.`,
    })
  }
  return insights
}
