'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Badge, EmptyRow, Input, Notice, PRIORITY_TONES, Pager, Select, TICKET_STATUS_LABELS, Table, adminApi, fmtDate,
  jsonInit, useDebounced, useList,
} from '../_ui';

type Ticket = {
  id: string; ref: string; createdAt: string; type: string; subject: string; priority: string; status: string;
  contactName: string | null; contactPhone: string | null; preferredCallbackTime: string | null; callId: string | null;
};

const LIMIT = 25;

export default function TicketsPage() {
  const [f, setF] = useState({ q: '', status: 'active', type: '', priority: '' });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(f.q);
  const list = useList<Ticket>('/v1/tickets', { ...f, q, limit: LIMIT, offset });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setOffset(0); };

  const setStatus = async (t: Ticket, status: string) => {
    try {
      await adminApi(`/v1/tickets/${t.ref}`, jsonInit('PATCH', { status }));
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <p className="text-sm text-zinc-500">Support issues and callback requests raised during calls.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input placeholder="Search number, subject, name or phone" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search tickets" />
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="active">Open or in progress</option>
          <option value="">All statuses</option>
          {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.type} onChange={(e) => set('type', e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="support">Support</option>
          <option value="callback">Callback</option>
        </Select>
        <Select value={f.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </Select>
      </div>
      {(error || list.error) && <Notice tone="error">{error ?? list.error}</Notice>}
      <Table
        head={['Ticket', 'Subject', 'Contact', 'Priority', 'Created', 'Status']}
        empty={list.data && !list.data.items.length ? <EmptyRow text="No tickets match these filters." /> : null}
      >
        {list.data?.items.map((t) => (
          <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <td className="whitespace-nowrap px-4 py-2.5">
              <Link href={`/admin/tickets/${t.ref}`} className="font-medium tabular-nums hover:underline">{t.ref}</Link>
              <div className="text-xs text-zinc-500">{t.type === 'callback' ? 'Callback' : 'Support'}</div>
            </td>
            <td className="max-w-sm px-4 py-2.5">
              <div className="truncate" title={t.subject}>{t.subject}</div>
              {t.preferredCallbackTime && <div className="text-xs text-zinc-500">Call: {t.preferredCallbackTime}</div>}
            </td>
            <td className="px-4 py-2.5">
              <div>{t.contactName ?? '—'}</div>
              {t.contactPhone && <div className="text-xs tabular-nums text-zinc-500">{t.contactPhone}</div>}
            </td>
            <td className="px-4 py-2.5"><Badge tone={PRIORITY_TONES[t.priority]}>{t.priority}</Badge></td>
            <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(t.createdAt)}</td>
            <td className="px-4 py-2.5">
              <Select value={t.status} onChange={(e) => void setStatus(t, e.target.value)} className="min-w-32 py-1" aria-label={`Status of ${t.ref}`}>
                {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onChange={setOffset} />}
    </div>
  );
}
