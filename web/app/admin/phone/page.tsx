'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AGENT_LABELS, Badge, Button, Card, Field, Input, Notice, Select, Textarea, adminApi, fmtDate, jsonInit,
} from '../_ui';

type Status = {
  bridgeRunning: boolean;
  sipUri: string | null;
  syncError: string | null;
  inbound: { numbers: number; auth: string };
  outbound: { configured: boolean; address: string | null; callerId: string | null };
  rules: {
    outboundHoursStart: string; outboundHoursEnd: string; autoCallbacks: boolean; timezone: string;
    maxCallbackAttempts: number; callbackRetryMinutes: number;
  };
};
type PhoneNumber = { id: string; number: string; label: string | null; workflow: string; enabled: boolean };
type Dnd = { number: string; note: string | null; addedBy: string | null; createdAt: string };
type Msg = { tone: 'success' | 'error'; text: string } | null;

const WORKFLOWS = ['router', 'sales', 'support', 'lead_qualification'];

function StatusCard({ s }: { s: Status }) {
  return (
    <Card title="Connection">
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500">SIP bridge</dt>
          <dd className="mt-1">{s.bridgeRunning ? <Badge tone="green">Running</Badge> : <Badge tone="amber">Not running</Badge>}</dd>
          {!s.bridgeRunning && <p className="mt-1 text-xs text-zinc-500">Start it with <code>make up-sip</code>.</p>}
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Incoming calls</dt>
          <dd className="mt-1">{s.inbound.numbers ? `${s.inbound.numbers} number${s.inbound.numbers > 1 ? 's' : ''}` : 'No numbers yet'}</dd>
          <p className="mt-1 text-xs text-zinc-500">
            Trunk sends calls to <code className="break-all">{s.sipUri ?? 'sip:<this host>:5060'}</code>; accepted from {s.inbound.auth}.
          </p>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Outgoing calls</dt>
          <dd className="mt-1">{s.outbound.configured ? <Badge tone="green">Set up</Badge> : <Badge>Off</Badge>}</dd>
          <p className="mt-1 text-xs text-zinc-500">
            {s.outbound.configured
              ? <>Via <code className="break-all">{s.outbound.address}</code>{s.outbound.callerId && <>, caller ID {s.outbound.callerId}</>}</>
              : <>Set <code>SIP_OUTBOUND_ADDRESS</code> (and your trunk login) in <code>.env</code>.</>}
          </p>
        </div>
      </dl>
      {s.syncError && <div className="mt-4"><Notice tone="error">Could not update LiveKit: {s.syncError}</Notice></div>}
    </Card>
  );
}

function NumbersCard({ numbers, reload }: { numbers: PhoneNumber[]; reload: () => void }) {
  const [draft, setDraft] = useState({ number: '', label: '', workflow: 'router' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      reload();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const update = (n: PhoneNumber, patch: Partial<PhoneNumber>) =>
    run(() => adminApi(`/v1/phone/numbers/${n.id}`, jsonInit('PUT', patch)));

  return (
    <Card title="Phone numbers">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Numbers your SIP trunk sends to AudioBots, and which agent answers each. Changes apply to the next call.
      </p>
      {numbers.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="py-1.5 pr-3 font-medium">Number</th><th className="py-1.5 pr-3 font-medium">Label</th><th className="py-1.5 pr-3 font-medium">Answered by</th><th className="py-1.5 pr-3 font-medium">On</th><th /></tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 tabular-nums">{n.number}</td>
                  <td className="py-2 pr-3">{n.label ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <Select aria-label={`Agent for ${n.number}`} value={n.workflow} disabled={busy} onChange={(e) => void update(n, { workflow: e.target.value })}>
                      {WORKFLOWS.map((w) => <option key={w} value={w}>{AGENT_LABELS[w] ?? w}</option>)}
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <input type="checkbox" aria-label={`Answer calls to ${n.number}`} checked={n.enabled} disabled={busy} onChange={(e) => void update(n, { enabled: e.target.checked })} />
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" disabled={busy} onClick={() => confirm(`Remove ${n.number}? Calls to it will no longer be answered.`) && void run(() => adminApi(`/v1/phone/numbers/${n.id}`, { method: 'DELETE' }))}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => adminApi('/v1/phone/numbers', jsonInit('POST', { ...draft, label: draft.label || null })), 'Number added.')
            .then(() => setDraft({ number: '', label: '', workflow: draft.workflow }));
        }}
      >
        <Field label="Number"><Input required placeholder="+918045671234" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} /></Field>
        <Field label="Label (optional)"><Input placeholder="Support line" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
        <Field label="Answered by">
          <Select value={draft.workflow} onChange={(e) => setDraft({ ...draft, workflow: e.target.value })}>
            {WORKFLOWS.map((w) => <option key={w} value={w}>{AGENT_LABELS[w] ?? w}</option>)}
          </Select>
        </Field>
        <Button type="submit" disabled={busy || !draft.number.trim()}>Add number</Button>
      </form>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}

function RulesCard({ s, reload }: { s: Status; reload: () => void }) {
  const [draft, setDraft] = useState({ start: s.rules.outboundHoursStart, end: s.rules.outboundHoursEnd, auto: s.rules.autoCallbacks });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  // Follow the saved rules after a reload (keeps the "Saved" message, unlike remounting).
  useEffect(() => {
    setDraft({ start: s.rules.outboundHoursStart, end: s.rules.outboundHoursEnd, auto: s.rules.autoCallbacks });
  }, [s.rules.outboundHoursStart, s.rules.outboundHoursEnd, s.rules.autoCallbacks]);
  const dirty = draft.start !== s.rules.outboundHoursStart || draft.end !== s.rules.outboundHoursEnd || draft.auto !== s.rules.autoCallbacks;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi('/v1/phone/rules', jsonInit('PUT', { outboundHoursStart: draft.start, outboundHoursEnd: draft.end, autoCallbacks: draft.auto }));
      setMsg({ tone: 'success', text: 'Saved.' });
      reload();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Outgoing call rules">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Allowed from (${s.rules.timezone})`}><Input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></Field>
        <Field label="Until"><Input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></Field>
      </div>
      <label className="mt-4 flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={draft.auto} onChange={(e) => setDraft({ ...draft, auto: e.target.checked })} />
        <span>
          <span className="text-sm font-medium">Call back automatically</span>
          <span className="block text-xs text-zinc-500">
            Open callback tickets are dialled at their scheduled time, up to {s.rules.maxCallbackAttempts} tries,
            {' '}{s.rules.callbackRetryMinutes} minutes apart. Calls outside the allowed hours wait for the next window.
          </span>
        </span>
      </label>
      <p className="mt-3 text-xs text-zinc-500">
        TRAI rules: service calls only, never to numbers on the do-not-call list below. Your trunk provider scrubs against the national NCPR registry.
      </p>
      <div className="mt-4"><Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rules'}</Button></div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}

function DndCard() {
  const [list, setList] = useState<{ items: Dnd[]; total: number }>({ items: [], total: 0 });
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => {
    adminApi<{ items: Dnd[]; total: number }>(`/v1/phone/dnd${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setList).catch(() => undefined);
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminApi<{ added: number; invalidCount: number; invalid: string[] }>('/v1/phone/dnd', jsonInit('POST', { numbers: text, note: note || undefined }));
      setMsg({
        tone: r.invalidCount ? 'error' : 'success',
        text: `Added ${r.added} number${r.added === 1 ? '' : 's'}.${r.invalidCount ? ` Skipped ${r.invalidCount} that aren't phone numbers: ${r.invalid.join(', ')}` : ''}`,
      });
      setText('');
      load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (n: string) => {
    await adminApi(`/v1/phone/dnd/${encodeURIComponent(n)}`, { method: 'DELETE' }).catch((e) => setMsg({ tone: 'error', text: e.message }));
    load();
  };

  return (
    <Card title="Do-not-call list">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">These numbers are never called, by the scheduler, the dashboard or the API.</p>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <Field label="Add numbers" hint="One per line, or paste a CSV column. Indian numbers can be written any common way.">
          <Textarea className="min-h-24" placeholder={'98450 12345\n+91 99000 11122'} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="space-y-3">
          <Field label="Note (optional)"><Input placeholder="Asked not to be called" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button disabled={busy || !text.trim()} onClick={() => void add()}>Add to list</Button>
        </div>
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-zinc-500">{list.total} number{list.total === 1 ? '' : 's'}</span>
        <Input className="w-56" placeholder="Search" aria-label="Search the do-not-call list" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.items.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {list.items.map((d) => (
            <li key={d.number} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="tabular-nums">{d.number}</span>
                <span className="ml-2 text-xs text-zinc-500">{[d.note, d.addedBy, fmtDate(d.createdAt)].filter(Boolean).join(' · ')}</span>
              </span>
              <Button variant="ghost" onClick={() => void remove(d.number)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function PhonePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    adminApi<Status>('/v1/phone').then(setStatus).catch((e) => setError(e.message));
    adminApi<PhoneNumber[]>('/v1/phone/numbers').then(setNumbers).catch(() => undefined);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!status) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Phone</h1>
        <p className="text-sm text-zinc-500">Phone numbers, outgoing calls and the do-not-call list.</p>
      </div>
      <StatusCard s={status} />
      <NumbersCard numbers={numbers} reload={reload} />
      <RulesCard s={status} reload={reload} />
      <DndCard />
    </div>
  );
}
