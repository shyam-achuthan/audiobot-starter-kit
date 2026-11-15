'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Badge, EmptyRow, Input, LEAD_STATUS_LABELS, Notice, Pager, Select, Table, fmtDate, useDebounced, useList,
} from '../_ui';

type Lead = {
  id: string; createdAt: string; name: string | null; phone: string | null; company: string | null;
  need: string | null; budget: string | null; timeline: string | null; score: number | null; status: string;
  preferredCallbackTime: string | null; callId: string | null;
};

const LIMIT = 25;

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-zinc-400">—</span>;
  return <Badge tone={score >= 70 ? 'green' : score >= 40 ? 'amber' : 'neutral'}>{score}</Badge>;
}

export default function LeadsPage() {
  const [f, setF] = useState({ q: '', status: '', minScore: '' });
  const [offset, setOffset] = useState(0);
  const q = useDebounced(f.q);
  const { data, error } = useList<Lead>('/v1/leads', { ...f, q, limit: LIMIT, offset });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setOffset(0); };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-zinc-500">Contacts captured by the sales and lead qualification agents. Score is 0–100.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="Search name, phone, company or need" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search leads" />
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.minScore} onChange={(e) => set('minScore', e.target.value)} aria-label="Minimum score">
          <option value="">Any score</option>
          <option value="70">Hot (70+)</option>
          <option value="40">Warm (40+)</option>
        </Select>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Table
        head={['Created', 'Name', 'Need', 'Budget', 'Timeline', 'Score', 'Status', 'Callback']}
        empty={data && !data.items.length ? <EmptyRow text="No leads match these filters." /> : null}
      >
        {data?.items.map((l) => (
          <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <td className="whitespace-nowrap px-4 py-2.5">
              <Link href={`/admin/leads/${l.id}`} className="font-medium hover:underline">{fmtDate(l.createdAt)}</Link>
            </td>
            <td className="px-4 py-2.5">
              <div>{l.name ?? <span className="text-zinc-400">Unnamed</span>}</div>
              <div className="text-xs tabular-nums text-zinc-500">{[l.phone, l.company].filter(Boolean).join(' · ')}</div>
            </td>
            <td className="max-w-xs truncate px-4 py-2.5 text-zinc-600 dark:text-zinc-400" title={l.need ?? ''}>{l.need ?? '—'}</td>
            <td className="px-4 py-2.5">{l.budget ?? '—'}</td>
            <td className="px-4 py-2.5">{l.timeline ?? '—'}</td>
            <td className="px-4 py-2.5"><ScoreBadge score={l.score} /></td>
            <td className="px-4 py-2.5">{LEAD_STATUS_LABELS[l.status] ?? l.status}</td>
            <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{l.preferredCallbackTime ?? '—'}</td>
          </tr>
        ))}
      </Table>
      {data && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
    </div>
  );
}
