// FX conversion to SGD using Frankfurter (ECB reference rates, no API key).
// Each transaction is converted at the rate of ITS OWN DATE (nearest earlier
// business day), not today's rate — so history stays accurate.
// Source of rates: https://api.frankfurter.dev (European Central Bank).
// If rates cannot be fetched, non-SGD amounts are reported unconverted and
// excluded from SGD totals, with a visible notice — never silently guessed.

const LS_KEY = 'spendwise_fx_v1'

async function fetchSeries(from, start, end) {
  const url = `https://api.frankfurter.dev/v1/${start}..${end}?base=${from}&symbols=SGD`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FX fetch failed for ${from}: ${res.status}`)
  const json = await res.json()
  return json.rates // { 'YYYY-MM-DD': { SGD: rate }, ... }
}

export async function loadFxRates(currencies, startDate, endDate) {
  const need = [...new Set(currencies)].filter((c) => c && c !== 'SGD')
  if (need.length === 0) return { rates: {}, fetchedAt: null, failed: [] }

  // localStorage cache: refetch only if stale (> 20h) or range not covered
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (
      cached &&
      Date.now() - cached.fetchedAt < 20 * 3600 * 1000 &&
      need.every((c) => cached.rates[c]) &&
      cached.start <= startDate &&
      cached.end >= endDate
    ) {
      return { rates: cached.rates, fetchedAt: cached.fetchedAt, failed: cached.failed || [] }
    }
  } catch {
    /* ignore cache errors */
  }

  const rates = {}
  const failed = []
  await Promise.all(
    need.map(async (c) => {
      try {
        rates[c] = await fetchSeries(c, startDate, endDate)
      } catch {
        failed.push(c)
      }
    })
  )
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ rates, fetchedAt: Date.now(), start: startDate, end: endDate, failed })
    )
  } catch {
    /* storage may be unavailable; fine */
  }
  return { rates, fetchedAt: Date.now(), failed }
}

// Rate for a currency on a date: exact day, else walk back up to 7 days
// (weekends/holidays have no ECB fixing).
export function rateFor(rates, currency, dateStr) {
  const series = rates[currency]
  if (!series) return null
  let d = new Date(dateStr + 'T00:00:00Z')
  for (let i = 0; i < 8; i++) {
    const key = d.toISOString().slice(0, 10)
    if (series[key]?.SGD) return series[key].SGD
    d = new Date(d.getTime() - 86400000)
  }
  // fall forward (dates before series start)
  const keys = Object.keys(series).sort()
  if (keys.length && dateStr < keys[0]) return series[keys[0]].SGD
  return null
}

// Returns { sgd: number|null, basis: 'stored'|'ecb-historical'|'unavailable' }
export function toSGD(txn, rates) {
  if (txn.currency === 'SGD') return { sgd: Number(txn.amount), basis: 'stored' }
  if (txn.amount_sgd != null) return { sgd: Number(txn.amount_sgd), basis: 'stored' }
  const r = rateFor(rates, txn.currency, txn.txn_date)
  if (r == null) return { sgd: null, basis: 'unavailable' }
  return { sgd: Number(txn.amount) * r, basis: 'ecb-historical' }
}
