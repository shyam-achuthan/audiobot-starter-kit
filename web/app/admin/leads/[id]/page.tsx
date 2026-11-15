'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  Button, Card, Field, LANGUAGE_LABELS, LEAD_STATUS_LABELS, Notice, Select, Textarea, adminApi, fmtDate, jsonInit,
} from '../../_ui';

type Lead = {
  id: string; createdAt: string; updatedAt: string; callId: string | null; name: string | null; phone: string | null;
  email: string | null; company: string | null; need: string | null; budget: string | null; authority: string | null;
  timeline: string | null; teamSize: string | null; score: number | null; status: string;
  preferredCallbackTime: string | null; language: string | null; notes: string | null;
};

const FIELDS: [keyof Lead, string][] = [
  ['phone', 'Phone'], ['email', 'Email'], ['company', 'Company'], ['need', 'Need'], ['teamSize', 'Team size'],
  ['budget', 'Budget'], ['authority', 'Decision maker'], ['timeline', 'Timeline'],
  ['preferredCallbackTime', 'Preferred callback time'],
];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [edit, setEdit] = useState({ status: '', notes: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi<Lead>(`/v1/leads/${id}`)
      .then((l) => { setLead(l); setEdit({ status: l.status, notes: l.notes ?? '' }); })
      .catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [id]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const l = await adminApi<Lead>(`/v1/leads/${id}`, jsonInit('PATCH', { status: edit.status, notes: edit.notes || undefined }));
      setLead(l);
      setMsg({ tone: 'success', text: 'Saved.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!lead) return msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/leads" className="text-sm text-zinc-500 hover:underline">← Leads</Link>
        <h1 className="mt-1 text-2xl font-semibold">{lead.name ?? 'Unnamed lead'}</h1>
        <p className="text-sm text-zinc-500">
          Captured {fmtDate(lead.createdAt)}
          {lead.language ? ` · ${LANGUAGE_LABELS[lead.language] ?? lead.language}` : ''}
          {lead.score != null ? ` · score ${lead.score}/100` : ''}
          {lead.callId && <> · <Link href={`/admin/calls/${lead.callId}`} className="underline">open call</Link></>}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Details from the call">
          <dl className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(([k, label]) => (
              <div key={k}>
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="mt-0.5 text-sm">{(lead[k] as string | null) ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Follow-up">
          <div className="space-y-4">
            <Field label="Status">
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
