'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarList, DailyBars, DailyLines } from './_charts';
import { AGENT_LABELS, Card, LANGUAGE_LABELS, Notice, OUTCOME_LABELS, adminApi, fmtMs } from './_ui';

type Stats = {
  days: number;
  totals: {
    calls: number; activeCalls: number; avgDurationS: number | null; leads: number; hotLeads: number;
    tickets: number; openTickets: number; pendingCallbacks: number;
  };
  latency: { turns: number; e2eP50: number | null; e2eP95: number | null; stages: Record<string, number | null> };
  daily: { day: string; calls: number; leads: number; tickets: number; e2eP50: number | null; e2eP95: number | null }[];
  outcomes: { key: string; count: number }[];
  workflows: { key: string; count: number }[];
  languages: { key: string; count: number }[];
};

const RANGES = [7, 14, 30];
const STAGES: [string, string][] = [['endOfTurn', 'End of turn'], ['stt', 'Speech to text'], ['llm', 'LLM first token'], ['tts', 'TTS first audio']];

function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <div className="h-full rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Overview() {
  const [days, setDays] = useState(14);
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi<Stats>(`/v1/stats?days=${days}`).then((d) => { setS(d); setError(null); }).catch((e) => setError(e.message));
  }, [days]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!s) return <div className="h-96" />;
  const t = s.totals;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Last {days} days</h2>
        <div role="group" aria-label="Date range" className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}
              className={`rounded-md px-3 py-1 ${days === r ? 'bg-white font-medium shadow-sm dark:bg-zinc-800' : 'text-zinc-600 dark:text-zinc-400'}`}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Calls" value={String(t.calls)} sub={t.activeCalls ? `${t.activeCalls} live now` : t.avgDurationS != null ? `avg ${Math.floor(t.avgDurationS / 60)}m ${t.avgDurationS % 60}s` : undefined} href="/admin/calls" />
        <Stat label="Leads" value={String(t.leads)} sub={`${t.hotLeads} scored 70+`} href="/admin/leads" />
        <Stat label="Open tickets" value={String(t.openTickets)} sub={`${t.tickets} raised in range`} href="/admin/tickets" />
        <Stat label="Callbacks to make" value={String(t.pendingCallbacks)} sub="open callback requests" href="/admin/tickets" />
        <Stat label="Reply time (median)" value={fmtMs(s.latency.e2eP50)} sub={`p95 ${fmtMs(s.latency.e2eP95)} · ${s.latency.turns} turns`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Calls per day">
          <DailyBars label="Calls" data={s.daily.map((d) => ({ day: d.day, value: d.calls }))} />
        </Card>
        <Card title="Voice-to-voice reply time">
          <DailyLines
            days={s.daily.map((d) => d.day)}
            fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)}
            series={[
              { key: 'p50', label: 'Median', color: 'var(--series-1)', values: s.daily.map((d) => d.e2eP50) },
              { key: 'p95', label: 'p95', color: 'var(--series-2)', values: s.daily.map((d) => d.e2eP95) },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Where reply time goes (median)">
          <BarList fmt={(v) => fmtMs(v)} items={STAGES.filter(([k]) => s.latency.stages[k] != null).map(([k, label]) => ({ label, value: s.latency.stages[k]! }))} />
          <p className="mt-3 text-xs text-zinc-500">Stages overlap (streaming), so they don&apos;t add up to the total.</p>
        </Card>
        <Card title="Call outcomes">
          <BarList items={s.outcomes.map((o) => ({ label: OUTCOME_LABELS[o.key] ?? o.key, value: o.count }))} />
        </Card>
        <Card title="Calls by agent and language">
          <BarList items={s.workflows.map((o) => ({ label: AGENT_LABELS[o.key] ?? o.key, value: o.count }))} />
          <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <BarList items={s.languages.map((o) => ({ label: LANGUAGE_LABELS[o.key] ?? o.key, value: o.count }))} />
          </div>
        </Card>
      </div>
    </div>
  );
}
