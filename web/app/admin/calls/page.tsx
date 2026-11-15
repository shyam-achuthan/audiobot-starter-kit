'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AGENT_LABELS, Badge, EmptyRow, Input, LANGUAGE_LABELS, Notice, OUTCOME_LABELS, Pager, Select, Table,
  fmtDate, fmtDuration, fmtMs, outcomeTone, useDebounced, useList,
} from '../_ui';

type Call = {
  id: string; startedAt: string; endedAt: string | null; status: string; outcome: string | null;
  agentPath: string[]; language: string | null; callerName: string | null; callerPhone: string | null;
  turnCount: number; medianE2eMs: number | null; channel: string;
};

const LIMIT = 25;

export default function CallsPage() {
  const [f, setF] = useState({ q: '', outcome: '', workflow: '', status: '' });
  const [offset, setOffset] = useState(0);
  const q = useDebounced(f.q);
  const { data, error } = useList<Call>('/v1/calls', { ...f, q, limit: LIMIT, offset });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setOffset(0); };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Calls</h1>
        <p className="text-sm text-zinc-500">Every conversation with the voice agents, newest first.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input placeholder="Search name or phone" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search calls" />
        <Select value={f.outcome} onChange={(e) => set('outcome', e.target.value)} aria-label="Outcome">
          <option value="">All outcomes</option>
          {['lead_captured', 'callback_requested', 'ticket_created', 'info_only', 'abandoned'].map((o) => (
            <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
          ))}
        </Select>
        <Select value={f.workflow} onChange={(e) => set('workflow', e.target.value)} aria-label="Agent">
          <option value="">All agents</option>
          {Object.entries(AGENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Live now</option>
          <option value="ended">Ended</option>
        </Select>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Table
        head={['Started', 'Caller', 'Agents', 'Language', 'Outcome', 'Turns', 'Median reply', 'Duration']}
        empty={data && !data.items.length ? <EmptyRow text="No calls match these filters." /> : null}
      >
        {data?.items.map((c) => (
          <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <td className="whitespace-nowrap px-4 py-2.5">
              <Link href={`/admin/calls/${c.id}`} className="font-medium hover:underline">{fmtDate(c.startedAt)}</Link>
            </td>
            <td className="px-4 py-2.5">
              <div>{c.callerName ?? <span className="text-zinc-400">Unknown</span>}</div>
              {c.callerPhone && <div className="text-xs tabular-nums text-zinc-500">{c.callerPhone}</div>}
            </td>
            <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{c.agentPath.map((a) => AGENT_LABELS[a] ?? a).join(' → ')}</td>
            <td className="px-4 py-2.5">{c.language ? LANGUAGE_LABELS[c.language] ?? c.language : '—'}</td>
            <td className="px-4 py-2.5">
              {c.status === 'active'
                ? <Badge tone="blue">Live</Badge>
                : <Badge tone={outcomeTone(c.outcome)}>{OUTCOME_LABELS[c.outcome ?? 'unknown']}</Badge>}
            </td>
            <td className="px-4 py-2.5 tabular-nums">{c.turnCount}</td>
            <td className="px-4 py-2.5 tabular-nums">{fmtMs(c.medianE2eMs)}</td>
            <td className="px-4 py-2.5 tabular-nums">{fmtDuration(c.startedAt, c.endedAt)}</td>
          </tr>
        ))}
      </Table>
      {data && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
    </div>
  );
}
