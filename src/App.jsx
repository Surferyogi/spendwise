import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { loadFxRates } from './fx.js'
import {
  CATEGORIES,
  CAT_COLORS,
  enrich,
  byMonth,
  sumBy,
  detectRecurring,
  findDuplicates,
  buildInsights,
  fmtSGD,
  fmtOrig,
  monthKey,
} from './analytics.js'
import { MonthlyBars, HBarList } from './charts.jsx'

// Version stamp — updated on every App.jsx change (vYYYY:MM:DD-HH:MM)
export const APP_VERSION = 'v2026:08:07-11:59'

const TABS = ['Overview', 'Transactions', 'Recurring', 'Insights', 'Budgets', 'Data']

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="app"><p style={{ color: 'var(--muted)' }}>Loading…</p></div>
  if (!session) return <Login />
  return <Main session={session} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message)
    setBusy(false)
  }
  const magicLink = async () => {
    if (!email) { setErr('Enter your email first.'); return }
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
    if (error) setErr(error.message)
    else setMsg('Login link sent — check your email.')
    setBusy(false)
  }

  return (
    <form className="login-box" onSubmit={signIn}>
      <h1>SpendWise</h1>
      <p style={{ color: 'var(--muted)', textAlign: 'center', margin: 0, fontSize: 13 }}>
        Sign in with your existing account (same login as life-compass).
      </p>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      {err && <div className="err">{err}</div>}
      {msg && <div style={{ color: 'var(--good)', fontSize: 13 }}>{msg}</div>}
      <button className="btn" disabled={busy} type="submit">Sign in</button>
      <button className="btn ghost" disabled={busy} type="button" onClick={magicLink}>Email me a login link</button>
      <div className="footer-note" style={{ textAlign: 'center' }}>{APP_VERSION}</div>
    </form>
  )
}

function Main({ session }) {
  const [tab, setTab] = useState('Overview')
  const [txns, setTxns] = useState(null)
  const [budgets, setBudgets] = useState([])
  const [fx, setFx] = useState({ rates: {}, fetchedAt: null, failed: [], loading: true })
  const [loadErr, setLoadErr] = useState('')

  const reload = async () => {
    const { data, error } = await supabase
      .from('spend_transactions')
      .select('*')
      .order('txn_date', { ascending: false })
      .limit(5000)
    if (error) { setLoadErr(error.message); return }
    setTxns(data)
    const { data: b } = await supabase.from('spend_budgets').select('*')
    setBudgets(b || [])
    if (data.length) {
      const dates = data.map((t) => t.txn_date)
      const currencies = data.map((t) => t.currency)
      const start = dates.reduce((a, b) => (a < b ? a : b))
      const end = new Date().toISOString().slice(0, 10)
      const res = await loadFxRates(currencies, start, end)
      setFx({ ...res, loading: false })
    } else {
      setFx({ rates: {}, fetchedAt: null, failed: [], loading: false })
    }
  }
  useEffect(() => { reload() }, [])

  const enriched = useMemo(() => (txns ? enrich(txns, fx.rates) : []), [txns, fx])
  const months = useMemo(() => byMonth(enriched), [enriched])
  const recurring = useMemo(() => detectRecurring(enriched), [enriched])
  const duplicates = useMemo(() => findDuplicates(enriched), [enriched])
  const insights = useMemo(() => buildInsights(enriched, months, recurring, duplicates), [enriched, months, recurring, duplicates])
  const unconverted = enriched.filter((t) => t.sgd == null)

  return (
    <div className="app">
      <header className="topbar">
        <h1>SpendWise</h1>
        <span className="version">{APP_VERSION}</span>
        <span className="spacer" />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{session.user.email}</span>
        <button className="btn ghost" style={{ padding: '5px 10px' }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {loadErr && <div className="notice">Could not load data: {loadErr}</div>}
      {!txns && !loadErr && <p style={{ color: 'var(--muted)' }}>Loading transactions…</p>}
      {txns && fx.loading && <div className="notice info">Fetching ECB exchange rates for conversion…</div>}
      {txns && !fx.loading && fx.failed.length > 0 && (
        <div className="notice">
          FX rates unavailable for {fx.failed.join(', ')} — those amounts are shown in their original currency and
          excluded from SGD totals (never guessed).
        </div>
      )}

      {txns && tab === 'Overview' && <Overview months={months} enriched={enriched} unconverted={unconverted} goTx={() => setTab('Transactions')} />}
      {txns && tab === 'Transactions' && <Transactions enriched={enriched} reload={reload} userId={session.user.id} />}
      {txns && tab === 'Recurring' && <Recurring recurring={recurring} />}
      {txns && tab === 'Insights' && <Insights insights={insights} />}
      {txns && tab === 'Budgets' && <Budgets budgets={budgets} months={months} reload={reload} userId={session.user.id} />}
      {txns && tab === 'Data' && <DataTab enriched={enriched} fx={fx} />}

      <div className="footer-note">
        Amounts come verbatim from parsed invoices/receipts (Gmail, PDFs, screenshots) or manual entry. Non-SGD amounts
        are converted at ECB daily reference rates (Frankfurter) on each transaction&apos;s date; the original amount is
        always kept. Categories are editable — analysis is only as good as the categorisation.
      </div>
    </div>
  )
}

function Overview({ months, enriched, unconverted, goTx }) {
  const [picked, setPicked] = useState(null)
  const nowM = monthKey(new Date().toISOString())
  const cur = months.find((m) => m.month === nowM)
  const completed = months.filter((m) => m.month < nowM)
  const lastM = completed[completed.length - 1]
  const prevM = completed[completed.length - 2]
  const last12 = months.slice(-13)
  const avg3 =
    completed.slice(-3).length > 0
      ? completed.slice(-3).reduce((s, m) => s + m.total, 0) / completed.slice(-3).length
      : null

  const scope = picked ? enriched.filter((t) => monthKey(t.txn_date) === picked) : enriched
  const catTotals = sumBy(scope, (t) => t.category).map((c) => ({ ...c, color: CAT_COLORS[c.name] }))
  const merchTotals = sumBy(scope, (t) => t.merchant).slice(0, 10)

  const delta = lastM && prevM && prevM.total > 0 ? ((lastM.total - prevM.total) / prevM.total) * 100 : null

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">This month ({nowM})</div>
          <div className="value">{fmtSGD(cur ? cur.total : 0, 0)}</div>
          <div className="delta">{cur ? `${cur.count} transactions` : 'no transactions yet'}</div>
        </div>
        <div className="tile">
          <div className="label">Last month {lastM ? `(${lastM.month})` : ''}</div>
          <div className="value">{fmtSGD(lastM?.total ?? null, 0)}</div>
          {delta != null && (
            <div className={`delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs {prevM.month}
            </div>
          )}
        </div>
        <div className="tile">
          <div className="label">3-month average</div>
          <div className="value">{fmtSGD(avg3, 0)}</div>
          <div className="delta">completed months</div>
        </div>
        <div className="tile">
          <div className="label">Tracked total</div>
          <div className="value">{fmtSGD(enriched.reduce((s, t) => s + (t.sgd || 0), 0), 0)}</div>
          <div className="delta">{enriched.length} txns since {months[0] ? months[0].month : '—'}</div>
        </div>
      </div>

      <div className="card">
        <h2>
          Monthly spend (SGD) <span className="sub">— click a bar to focus; hover for breakdown</span>
        </h2>
        <MonthlyBars months={last12} picked={picked} onPick={(m) => setPicked(picked === m ? null : m)} />
      </div>

      <div className="card">
        <h2>
          By category <span className="sub">{picked ? `— ${picked}` : '— all time'}</span>
        </h2>
        <HBarList items={catTotals} onPick={goTx} />
      </div>

      <div className="card">
        <h2>
          Top merchants <span className="sub">{picked ? `— ${picked}` : '— all time'}</span>
        </h2>
        <HBarList items={merchTotals} color="var(--series-3)" />
      </div>

      {unconverted.length > 0 && (
        <div className="notice">
          {unconverted.length} transaction(s) not in SGD totals (no FX rate available):{' '}
          {unconverted.slice(0, 5).map((t) => `${t.merchant} ${fmtOrig(t.amount, t.currency)}`).join('; ')}
          {unconverted.length > 5 ? '…' : ''}
        </div>
      )}
    </>
  )
}

function Transactions({ enriched, reload, userId }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [month, setMonth] = useState('')
  const [sort, setSort] = useState({ key: 'txn_date', dir: -1 })
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const monthsAvail = [...new Set(enriched.map((t) => monthKey(t.txn_date)))].sort().reverse()

  let rows = enriched.filter(
    (t) =>
      (!cat || t.category === cat) &&
      (!month || monthKey(t.txn_date) === month) &&
      (!q || (t.merchant + ' ' + (t.description || '')).toLowerCase().includes(q.toLowerCase()))
  )
  rows = [...rows].sort((a, b) => {
    const { key, dir } = sort
    const va = key === 'sgd' ? a.sgd ?? -1 : a[key] ?? ''
    const vb = key === 'sgd' ? b.sgd ?? -1 : b[key] ?? ''
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir
  })
  const shownTotal = rows.reduce((s, t) => s + (t.sgd || 0), 0)

  const setSortKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))

  const updateCat = async (t, newCat) => {
    setBusyId(t.id)
    await supabase.from('spend_transactions').update({ category: newCat, updated_at: new Date().toISOString() }).eq('id', t.id)
    setBusyId(null)
    reload()
  }
  const del = async (t) => {
    if (!confirm(`Delete ${t.merchant} ${fmtOrig(t.amount, t.currency)} on ${t.txn_date}?`)) return
    setBusyId(t.id)
    await supabase.from('spend_transactions').delete().eq('id', t.id)
    setBusyId(null)
    reload()
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <input type="text" placeholder="Search merchant / description" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {monthsAvail.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn ghost" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Add manual'}</button>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 8 }}>
          {rows.length} transactions · SGD-convertible total {fmtSGD(shownTotal)}
        </div>
      </div>

      {adding && <ManualAdd userId={userId} done={() => { setAdding(false); reload() }} />}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tx">
          <thead>
            <tr>
              <th onClick={() => setSortKey('txn_date')}>Date</th>
              <th onClick={() => setSortKey('merchant')}>Merchant</th>
              <th className="hide-sm">Category</th>
              <th className="num" onClick={() => setSortKey('amount')}>Original</th>
              <th className="num" onClick={() => setSortKey('sgd')}>SGD</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{t.txn_date}</td>
                <td>
                  <div className="merchant">{t.merchant}</div>
                  <div className="desc" title={t.description || ''}>{t.description}</div>
                </td>
                <td className="hide-sm">
                  <span className="catchip">
                    <span className="dot" style={{ background: CAT_COLORS[t.category] || 'var(--muted)' }} />
                    <select value={t.category} disabled={busyId === t.id} onChange={(e) => updateCat(t, e.target.value)} style={{ padding: '3px 6px', fontSize: 12 }}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </span>
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtOrig(t.amount, t.currency)}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {t.sgd != null ? fmtSGD(t.sgd) : '—'}
                  {t.basis === 'ecb-historical' && <span title="Converted at ECB rate on transaction date" style={{ color: 'var(--muted)' }}>*</span>}
                </td>
                <td>
                  <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 12 }} disabled={busyId === t.id} onClick={() => del(t)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 8 }}>
          * converted at the ECB daily reference rate on the transaction date (source: Frankfurter/ECB).
        </div>
      </div>
    </>
  )
}

function ManualAdd({ userId, done }) {
  const [f, setF] = useState({ txn_date: new Date().toISOString().slice(0, 10), merchant: '', description: '', category: 'Other', amount: '', currency: 'SGD' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.merchant || !f.amount || isNaN(Number(f.amount))) { setErr('Merchant and a numeric amount are required.'); return }
    setBusy(true); setErr('')
    const row = {
      user_id: userId,
      txn_date: f.txn_date,
      merchant: f.merchant.trim(),
      description: f.description.trim() || null,
      category: f.category,
      amount: Number(f.amount),
      currency: f.currency,
      fx_rate: f.currency === 'SGD' ? 1 : null,
      amount_sgd: f.currency === 'SGD' ? Number(f.amount) : null,
      source: 'manual',
      source_ref: null,
    }
    const { error } = await supabase.from('spend_transactions').insert(row)
    setBusy(false)
    if (error) setErr(error.message)
    else done()
  }

  return (
    <div className="card">
      <h2>Add manual transaction</h2>
      <div className="form-grid">
        <label>Date<input type="date" value={f.txn_date} onChange={set('txn_date')} /></label>
        <label>Merchant<input type="text" value={f.merchant} onChange={set('merchant')} /></label>
        <label>Description<input type="text" value={f.description} onChange={set('description')} /></label>
        <label>Category
          <select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>Amount<input type="number" step="0.01" value={f.amount} onChange={set('amount')} /></label>
        <label>Currency
          <select value={f.currency} onChange={set('currency')}>
            {['SGD', 'USD', 'JPY', 'MYR', 'KRW', 'EUR', 'GBP', 'THB', 'IDR', 'AUD', 'HKD', 'TWD', 'CNY', 'PHP', 'VND', 'INR'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {err && <div style={{ color: 'var(--series-8)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 10 }}>
        <button className="btn" onClick={save} disabled={busy}>Save</button>
      </div>
    </div>
  )
}

function Recurring({ recurring }) {
  const active = recurring.filter((r) => !r.lapsed)
  const lapsed = recurring.filter((r) => r.lapsed)
  const totalMonthly = active.reduce((s, r) => s + (r.monthly || 0), 0)
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Active recurring</div>
          <div className="value">{active.length}</div>
          <div className="delta">detected from charge cadence</div>
        </div>
        <div className="tile">
          <div className="label">Monthly commitment</div>
          <div className="value">{fmtSGD(totalMonthly, 0)}</div>
          <div className="delta">≈ {fmtSGD(totalMonthly * 12, 0)} / year</div>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Active recurring charges <span className="sub">— ranked by annualised cost; the top of this list is where savings live</span></h2>
        <RecTable rows={active} />
      </div>
      {lapsed.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Lapsed / stopped <span className="sub">— no recent charge at their usual cadence</span></h2>
          <RecTable rows={lapsed} />
        </div>
      )}
      <div className="footer-note">
        Detection rule: ≥3 charges from the same merchant with a regular gap (weekly / monthly / quarterly / annual), or
        an explicit &quot;annual&quot; plan in the receipt. Per-charge figures are averages of the actual charges;
        usage-based items (e.g. AI auto-recharges) appear when they recur regularly and reflect real usage, not a fixed fee.
      </div>
    </>
  )
}

function RecTable({ rows }) {
  return (
    <table className="tx">
      <thead>
        <tr>
          <th>Merchant</th>
          <th className="hide-sm">Cadence</th>
          <th className="num">Avg/charge</th>
          <th className="num">≈ Monthly</th>
          <th className="num">≈ Annual</th>
          <th>Last charge</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.merchant}>
            <td>
              <div className="merchant">{r.merchant}</div>
              <div className="desc">
                {r.count} charges · {r.category}
                {r.priceChange && (
                  <span style={{ color: 'var(--warning)' }}>
                    {' '}· price {fmtSGD(r.priceChange.from)} → {fmtSGD(r.priceChange.to)}
                  </span>
                )}
              </div>
            </td>
            <td className="hide-sm">{r.cadence}</td>
            <td className="num">{fmtSGD(r.perCharge)}</td>
            <td className="num">{fmtSGD(r.monthly)}</td>
            <td className="num">{fmtSGD(r.annualized)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{r.lastDate}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Insights({ insights }) {
  const icon = { info: 'ℹ️', warn: '⚠️', crit: '🔴', good: '✅' }
  return (
    <>
      <div className="card">
        <h2>Computed insights <span className="sub">— every figure below comes from your own transactions, nothing is estimated</span></h2>
        {insights.length === 0 && <div className="desc">Not enough data yet for insights.</div>}
        {insights.map((ins, i) => (
          <div key={i} className={`insight ${ins.level}`}>
            <div className="head"><span className="icon">{icon[ins.level] || ''}</span>{ins.head}</div>
            {ins.body && <div className="body">{ins.body}</div>}
          </div>
        ))}
      </div>
      <div className="footer-note">
        How to use this tab to spend less: (1) start with the Recurring tab — cancelling or downgrading standing charges
        is the only saving that repeats every month without willpower; (2) act on price-change and duplicate flags —
        they are pure waste; (3) for the biggest month-on-month movers, open Transactions filtered to that category and
        decide deliberately whether the driver was one-off or a habit.
      </div>
    </>
  )
}

function Budgets({ budgets, months, reload, userId }) {
  const nowM = monthKey(new Date().toISOString())
  const cur = months.find((m) => m.month === nowM)
  const [cat, setCat] = useState(CATEGORIES[0])
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!limit || isNaN(Number(limit))) return
    setBusy(true)
    await supabase.from('spend_budgets').upsert(
      { user_id: userId, category: cat, monthly_limit_sgd: Number(limit) },
      { onConflict: 'user_id,category' }
    )
    setBusy(false)
    setLimit('')
    reload()
  }
  const remove = async (b) => {
    await supabase.from('spend_budgets').delete().eq('id', b.id)
    reload()
  }

  return (
    <>
      <div className="card">
        <h2>Set a monthly budget (SGD)</h2>
        <div className="row">
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input type="number" placeholder="Monthly limit" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 140 }} />
          <button className="btn" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
      <div className="card">
        <h2>{nowM} vs budget</h2>
        {budgets.length === 0 && <div className="desc">No budgets set yet. Tip: set limits on your top 3 categories first.</div>}
        {budgets.map((b) => {
          const spent = cur?.cats[b.category] || 0
          const pct = Math.min((spent / Number(b.monthly_limit_sgd)) * 100, 100)
          const over = spent > Number(b.monthly_limit_sgd)
          return (
            <div key={b.id} className="budget-row">
              <div className="top">
                <span className="catchip">
                  <span className="dot" style={{ background: CAT_COLORS[b.category] || 'var(--muted)' }} />
                  {b.category}
                </span>
                <span style={{ color: over ? 'var(--critical)' : 'var(--text-secondary)' }}>
                  {fmtSGD(spent)} / {fmtSGD(Number(b.monthly_limit_sgd))}
                  {over && ' — over'}
                  <button className="btn ghost" style={{ padding: '1px 7px', marginLeft: 8, fontSize: 11 }} onClick={() => remove(b)}>✕</button>
                </span>
              </div>
              <div className="budget-track">
                <div className="budget-fill" style={{ width: `${pct}%`, background: over ? 'var(--critical)' : pct > 80 ? 'var(--warning)' : 'var(--good)' }} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function DataTab({ enriched, fx }) {
  const bySource = {}
  for (const t of enriched) bySource[t.source] = (bySource[t.source] || 0) + 1
  const byCurrency = {}
  for (const t of enriched) byCurrency[t.currency] = (byCurrency[t.currency] || 0) + 1

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(enriched, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `spendwise-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  const exportCsv = () => {
    const cols = ['txn_date', 'merchant', 'description', 'category', 'amount', 'currency', 'sgd', 'source', 'source_ref']
    const esc = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`)
    const csv = [cols.join(','), ...enriched.map((t) => cols.map((c) => esc(c === 'sgd' ? (t.sgd != null ? t.sgd.toFixed(2) : '') : t[c])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `spendwise-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <>
      <div className="card">
        <h2>Dataset</h2>
        <p style={{ margin: '4px 0' }}>{enriched.length} transactions.</p>
        <p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>
          By source: {Object.entries(bySource).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
        <p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>
          By currency: {Object.entries(byCurrency).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
        <p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>
          FX rates: {fx.fetchedAt ? `ECB reference rates via Frankfurter, fetched ${new Date(fx.fetchedAt).toLocaleString()}` : 'not loaded'}
          {fx.failed?.length ? ` (failed: ${fx.failed.join(', ')})` : ''}
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
          <button className="btn ghost" onClick={exportJson}>Export JSON</button>
        </div>
      </div>
      <div className="card">
        <h2>Adding invoices</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.6 }}>
          New invoices flow in two ways: (1) give screenshots/PDFs or a Gmail refresh request to Claude (Cowork), which
          parses them and inserts rows directly into this database — duplicates are prevented by the receipt reference;
          (2) the <b>+ Add manual</b> button in the Transactions tab. Bank/PDF statements whose figures aren&apos;t in
          the email body (e.g. Scoot e-tickets, hotel folios, Royal Perak statements) need the PDF itself.
        </p>
      </div>
    </>
  )
}
