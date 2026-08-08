import React, { useState, useRef } from 'react'
import { fmtSGD } from './analytics.js'

// Monthly total bars — single series (magnitude job → one hue), hover tooltip
// with per-category breakdown for the hovered month.
export function MonthlyBars({ months, onPick, picked }) {
  const [tip, setTip] = useState(null)
  const wrapRef = useRef(null)
  if (!months.length) return <div className="desc">No data yet.</div>

  const W = 720
  const H = 210
  const padL = 52
  const padB = 26
  const padT = 12
  const max = Math.max(...months.map((m) => m.total), 1)
  const innerW = W - padL - 8
  const innerH = H - padB - padT
  const bw = Math.min(46, (innerW / months.length) * 0.72)
  const step = innerW / months.length

  // y ticks: 4 round steps
  const tickStep = niceStep(max / 4)
  const ticks = []
  for (let v = 0; v <= max * 1.02; v += tickStep) ticks.push(v)

  const show = (e, m) => {
    const rect = wrapRef.current.getBoundingClientRect()
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, m })
  }

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly spending in SGD">
        {ticks.map((v) => {
          const y = padT + innerH - (v / max) * innerH
          return (
            <g key={v}>
              <line x1={padL} x2={W - 4} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">
                {v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k' : Math.round(v)}
              </text>
            </g>
          )
        })}
        {months.map((m, i) => {
          const h = (m.total / max) * innerH
          const x = padL + i * step + (step - bw) / 2
          const y = padT + innerH - h
          const isPicked = picked === m.month
          return (
            <g key={m.month}>
              <rect
                x={padL + i * step}
                y={padT}
                width={step}
                height={innerH + padB}
                fill="transparent"
                style={{ cursor: onPick ? 'pointer' : 'default' }}
                onMouseMove={(e) => show(e, m)}
                onMouseLeave={() => setTip(null)}
                onClick={() => onPick && onPick(m.month)}
              />
              <rect
                x={x}
                y={y}
                width={bw}
                height={Math.max(h, 1)}
                rx="4"
                ry="4"
                fill={isPicked ? 'var(--series-2)' : 'var(--series-1)'}
                style={{ pointerEvents: 'none' }}
              />
              {/* square off bottom corners: bars anchor to baseline */}
              <rect x={x} y={padT + innerH - Math.min(h, 4)} width={bw} height={Math.min(h, 4)} fill={isPicked ? 'var(--series-2)' : 'var(--series-1)'} style={{ pointerEvents: 'none' }} />
              {(months.length <= 10 || i % 2 === months.length % 2 || isPicked) && (
                <text
                  x={padL + i * step + step / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill={isPicked ? 'var(--text-primary)' : 'var(--muted)'}
                >
                  {monthLabel(m.month)}
                </text>
              )}
            </g>
          )
        })}
        <line x1={padL} x2={W - 4} y1={padT + innerH} y2={padT + innerH} stroke="var(--baseline)" strokeWidth="1" />
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 12, 560), top: tip.y - 10 }}>
          <div className="t-title">
            {tip.m.month} — {fmtSGD(tip.m.total)}
          </div>
          {Object.entries(tip.m.cats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([c, v]) => (
              <div key={c} className="t-row">
                {c}: {fmtSGD(v)}
              </div>
            ))}
          {tip.m.unconverted.length > 0 && <div className="t-row">+{tip.m.unconverted.length} unconverted</div>}
        </div>
      )}
    </div>
  )
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(ym) {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[Number(m) - 1]}’${y.slice(2)}`
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

// Horizontal bar list — magnitude job, single hue, value labels at row end.
export function HBarList({ items, color = 'var(--series-1)', max: maxProp, fmt = fmtSGD, onPick }) {
  if (!items.length) return <div className="desc">Nothing to show.</div>
  const max = maxProp || Math.max(...items.map((i) => i.total))
  return (
    <div>
      {items.map((it) => (
        <div
          key={it.name}
          className="hbar-row"
          style={{ cursor: onPick ? 'pointer' : 'default' }}
          onClick={() => onPick && onPick(it.name)}
          title={it.name}
        >
          <div className="name">{it.name}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(it.total / max) * 100}%`, background: it.color || color }} />
          </div>
          <div className="val">{fmt(it.total)}</div>
        </div>
      ))}
    </div>
  )
}
