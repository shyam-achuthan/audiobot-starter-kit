'use client';

// Small SVG charts for the dashboard (no chart library). Thin marks, recessive grid,
// hover tooltips, and a table view under each chart.
import { useMemo, useRef, useState, type ReactNode } from 'react';

const W = 640;
const H = 200;
const PAD = { top: 12, right: 44, bottom: 24, left: 40 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

function dayLabel(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function Tooltip({ x, children }: { x: number; children: ReactNode }) {
  // x in 0..1 of the chart width; flip to the left side near the right edge.
  const style = x > 0.7 ? { right: `${(1 - x) * 100}%` } : { left: `${x * 100}%` };
  return (
    <div role="status" className="pointer-events-none absolute top-0 z-10 -translate-y-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      style={{ ...style, marginLeft: x > 0.7 ? 0 : 8, marginRight: x > 0.7 ? 8 : 0 }}>
      {children}
    </div>
  );
}

function Axes({ max, fmt, labels }: { max: number; fmt: (v: number) => string; labels: { x: number; text: string }[] }) {
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max);
  return (
    <g fontSize="11" fill="var(--viz-axis)">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
          <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">{fmt(t)}</text>
        </g>
      ))}
      {labels.map((l) => <text key={l.x} x={l.x} y={H - 6} textAnchor="middle">{l.text}</text>)}
    </g>
  );
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs text-zinc-500">
      <summary className="cursor-pointer select-none">Show as table</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead><tr>{head.map((h) => <th key={h} className="py-1 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">{r.map((c, j) => <td key={j} className="py-1">{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

function xLabels(days: string[], xAt: (i: number) => number) {
  const every = Math.max(1, Math.ceil(days.length / 7));
  const last = days.length - 1;
  // Every Nth day plus the last one, skipping a regular label that would collide with it.
  return days.map((d, i) => ({ i, d })).filter(({ i }) => i === last || (i % every === 0 && last - i >= every))
    .map(({ i, d }) => ({ x: xAt(i), text: dayLabel(d) }));
}

/** Single-series daily bars (e.g. calls per day). */
export function DailyBars({ data, label }: { data: { day: string; value: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const bw = Math.max(2, Math.min(28, slot - 2)); // >= 2px gap between bars
  const xAt = (i: number) => PAD.left + slot * i + slot / 2;
  const r = Math.min(4, bw / 2);

  return (
    <div className="viz relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label} per day`}
        onMouseLeave={() => setHover(null)}>
        <Axes max={max} fmt={(v) => String(Math.round(v))} labels={xLabels(data.map((d) => d.day), xAt)} />
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const x = xAt(i) - bw / 2;
          const y0 = PAD.top + plotH;
          const rr = Math.min(r, h);
          // Rounded data end (top), square at the baseline.
          const path = h <= 0 ? '' : `M${x},${y0} V${y0 - h + rr} Q${x},${y0 - h} ${x + rr},${y0 - h} H${x + bw - rr} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + rr} V${y0} Z`;
          return (
            <g key={d.day}>
              {path && <path d={path} fill="var(--series-1)" opacity={hover === null || hover === i ? 1 : 0.45} />}
              {/* Hit target wider and taller than the bar. */}
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${dayLabel(d.day)}: ${d.value}`} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip x={xAt(hover) / W}>
          <div className="font-medium">{dayLabel(data[hover].day)}</div>
          <div className="tabular-nums">{data[hover].value} {label.toLowerCase()}</div>
        </Tooltip>
      )}
      <TableView head={['Day', label]} rows={data.map((d) => [dayLabel(d.day), d.value])} />
    </div>
  );
}

type Series = { key: string; label: string; color: string; values: (number | null)[] };

/** Multi-series daily lines with a crosshair tooltip (e.g. latency p50 / p95). */
export function DailyLines({ days, series, fmt }: { days: string[]; series: Series[]; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const max = niceMax(Math.max(...all, 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xAt = (i: number) => PAD.left + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
  const yAt = (v: number) => PAD.top + plotH * (1 - v / max);

  const paths = useMemo(() => series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xAt(i)},${yAt(v)} `;
      pen = true;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [series, max, days.length]);

  const onMove = (e: React.MouseEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((x - PAD.left) / plotW) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  };

  // Direct labels at the last non-null point of each series.
  const ends = series.map((s) => {
    const i = s.values.map((v, j) => (v == null ? -1 : j)).filter((j) => j >= 0).pop();
    return i === undefined ? null : { s, i, v: s.values[i]! };
  }).filter(Boolean) as { s: Series; i: number; v: number }[];

  return (
    <div className="viz relative">
      <div className="mb-2 flex gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={series.map((s) => s.label).join(' and ') + ' per day'}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <Axes max={max} fmt={fmt} labels={xLabels(days, xAt)} />
        {hover !== null && <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--viz-axis)" strokeWidth="1" strokeDasharray="3 3" />}
        {series.map((s, k) => (
          <path key={s.key} d={paths[k]} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* Isolated points (neighbours missing) still need a visible mark. */}
        {series.map((s) => s.values.map((v, i) => (v != null && s.values[i - 1] == null && s.values[i + 1] == null
          ? <circle key={`${s.key}${i}`} cx={xAt(i)} cy={yAt(v)} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" /> : null)))}
        {hover !== null && series.map((s) => s.values[hover] != null && (
          <circle key={s.key} cx={xAt(hover)} cy={yAt(s.values[hover]!)} r="4.5" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />
        ))}
        {ends.map(({ s, i, v }) => (
          <text key={s.key} x={xAt(i) + 6} y={yAt(v)} fontSize="11" dominantBaseline="middle" fill="var(--viz-axis)">{s.label}</text>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={xAt(hover) / W}>
          <div className="font-medium">{dayLabel(days[hover])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}: {s.values[hover] == null ? 'no calls' : fmt(s.values[hover]!)}
            </div>
          ))}
        </Tooltip>
      )}
      <TableView head={['Day', ...series.map((s) => s.label)]}
        rows={days.map((d, i) => [dayLabel(d), ...series.map((s) => (s.values[i] == null ? '—' : fmt(s.values[i]!)))])} />
    </div>
  );
}

/** Horizontal magnitude bars with the value as text (one hue; categories are labelled). */
export function BarList({ items, fmt = String }: { items: { label: string; value: number }[]; fmt?: (v: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length) return <p className="text-sm text-zinc-500">No data yet.</p>;
  return (
    <ul className="viz space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-3">
            <span>{i.label}</span>
            <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{fmt(i.value)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-1.5 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: 'var(--series-1)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
