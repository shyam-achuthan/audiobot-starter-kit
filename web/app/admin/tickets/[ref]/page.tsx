'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  Button, Card, CrmLinks, Field, LANGUAGE_LABELS, Notice, Select, TICKET_STATUS_LABELS, Textarea, adminApi, fmtDate, jsonInit,
} from '../../_ui';
import type { CrmLink } from '../../_ui';

type Ticket = {
  id: string; ref: string; createdAt: string; updatedAt: string; type: string; subject: string;
  description: string | null; priority: string; status: string; contactName: string | null;
  contactPhone: string | null; contactEmail: string | null; preferredCallbackTime: string | null;
  language: string | null; callId: string | null; leadId: string | null;
  crmLinks?: CrmLink[];
};

export default function TicketDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const [t, setT] = useState<Ticket | null>(null);
  const [edit, setEdit] = useState({ status: '', priority: '', description: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi<Ticket>(`/v1/tickets/${ref}`)
      .then((x) => { setT(x); setEdit({ status: x.status, priority: x.priority, description: x.description ?? '' }); })
      .catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [ref]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      setT(await adminApi<Ticket>(`/v1/tickets/${ref}`, jsonInit('PATCH', {
        status: edit.status, priority: edit.priority, description: edit.description || undefined,
      })));
      setMsg({ tone: 'success', text: 'Saved.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!t) return msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null;

  const contact: [string, string | null][] = [
    ['Name', t.contactName], ['Phone', t.contactPhone], ['Email', t.contactEmail],
    ['Preferred callback time', t.preferredCallbackTime],
    ['Language', t.language ? LANGUAGE_LABELS[t.language] ?? t.language : null],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/tickets" className="text-sm text-zinc-500 hover:underline">← Tickets</Link>
        <h1 className="mt-1 text-2xl font-semibold"><span className="tabular-nums">{t.ref}</span> · {t.subject}</h1>
        <p className="text-sm text-zinc-500">
          {t.type === 'callback' ? 'Callback request' : 'Support ticket'} · opened {fmtDate(t.createdAt)}
          {t.callId && <> · <Link href={`/admin/calls/${t.callId}`} className="underline">open call</Link></>}
          {t.leadId && <> · <Link href={`/admin/leads/${t.leadId}`} className="underline">open lead</Link></>}
          <CrmLinks links={t.crmLinks} />
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Ticket">
          <div className="space-y-4">
            <Field label="Description">
              <Textarea value={edit.description} className="min-h-40" onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                  {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </Select>
              </Field>
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </Card>
        <Card title="Contact">
          <dl className="space-y-3">
            {contact.map(([label, v]) => (
              <div key={label}>
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="mt-0.5 text-sm tabular-nums">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
