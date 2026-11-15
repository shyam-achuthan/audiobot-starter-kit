'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  Badge, Button, Card, EmptyRow, Field, Input, Notice, Pager, Select, Table, adminApi, fmtDate, jsonInit, useList,
} from '../_ui';

type Last7d = { succeeded: number; pending: number; dead: number; lastActivityAt: string | null };
type ConnectorInfo = {
  name: 'twenty' | 'chatwoot'; label: string; configured: boolean; reachable?: boolean; detail?: string;
  appUrl?: string; missing?: string[]; last7d: Last7d;
};
type Endpoint = {
  id: string; name: string; url: string; events: string[]; enabled: boolean; secretHint: string | null;
  createdAt: string; last7d: Last7d;
};
type Overview = {
  eventTypes: string[]; retry: { maxAttempts: number; delaysSec: number[] };
  connectors: ConnectorInfo[]; endpoints: Endpoint[];
};
type Delivery = {
  id: string; status: string; attempts: number; connector: string | null; endpointId: string | null;
  lastStatusCode: number | null; lastError: string | null; lastResponse: string | null; lastDurationMs: number | null;
  nextAttemptAt: string; deliveredAt: string | null; createdAt: string;
  event?: { id: string; type: string; subject: string; createdAt: string; payload?: unknown };
  endpoint?: { id: string; name: string; url: string } | null;
};

const EVENT_HELP: Record<string, string> = {
  'call.started': 'A call connected',
  'call.ended': 'A call ended (includes outcome, timing and transcript)',
  'lead.created': 'The agent captured a new lead',
  'lead.updated': 'A lead changed (agent or dashboard); lists the changed fields',
  'ticket.created': 'A support ticket or callback request was created',
  'ticket.updated': 'A ticket changed (dashboard, agent or Chatwoot)',
};

const CONNECTOR_SYNCS: Record<string, string> = {
  twenty: 'Leads become a person, company and opportunity in Twenty, with a note holding the qualification answers. The opportunity stage follows the lead status; stages you move in Twenty are kept.',
  chatwoot: 'Tickets and callback requests become conversations in the "Voice calls" inbox, with the call transcript as a private note. Resolving a conversation in Chatwoot resolves the ticket here.',
};

function fmtDelay(s: number) {
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

function DeliveryStatus({ d }: { d: Pick<Delivery, 'status' | 'attempts'> }) {
  if (d.status === 'succeeded') return <Badge tone="green">Delivered</Badge>;
  if (d.status === 'dead') return <Badge tone="red">Failed</Badge>;
  if (d.status === 'sending') return <Badge tone="blue">Sending</Badge>;
  return d.attempts > 0 ? <Badge tone="amber">Retrying</Badge> : <Badge>Queued</Badge>;
}

function Counts({ s }: { s: Last7d }) {
  return (
    <p className="text-xs text-zinc-500">
      Last 7 days: {s.succeeded} delivered
      {s.pending > 0 && <> · <span className="text-amber-700 dark:text-amber-400">{s.pending} waiting</span></>}
      {s.dead > 0 && <> · <span className="text-red-700 dark:text-red-400">{s.dead} failed</span></>}
      {s.lastActivityAt && <> · last {fmtDate(s.lastActivityAt)}</>}
    </p>
  );
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" type="button" className="py-1" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    }}>{done ? 'Copied' : label}</Button>
  );
}

function EventPicker({ all, value, onChange }: { all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const everything = value.length === 0;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Events</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={everything} onChange={(e) => onChange(e.target.checked ? [] : [all[0]])} />
        All events, including ones added later
      </label>
      {!everything && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {all.map((t) => (
            <label key={t} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={value.includes(t)}
                onChange={(e) => {
                  const next = e.target.checked ? [...value, t] : value.filter((x) => x !== t);
                  onChange(next.length ? next : value);
                }} />
              <span><code className="text-xs">{t}</code><span className="block text-xs text-zinc-500">{EVENT_HELP[t]}</span></span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ConnectorCard({ c, onBackfill, onShowLog }: { c: ConnectorInfo; onBackfill: () => void; onShowLog: () => void }) {
  const badge = !c.configured ? <Badge>Not set up</Badge>
    : c.reachable ? <Badge tone="green">Connected</Badge> : <Badge tone="red">Can&apos;t connect</Badge>;
  return (
    <Card title={<span className="flex items-center gap-2">{c.label} {badge}</span>}>
      <div className="space-y-3 text-sm">
        <p className="text-zinc-600 dark:text-zinc-400">{CONNECTOR_SYNCS[c.name]}</p>
        {c.configured && c.reachable === false && <Notice tone="error">{c.detail}</Notice>}
        {!c.configured && (
          <Notice>
            Start the bundled apps with <code>make up-crm</code>, then run <code>make crm-setup</code>.
            {c.missing?.length ? <> Missing in <code>.env</code>: {c.missing.map((m) => <code key={m} className="mr-1">{m}</code>)}</> : null}
          </Notice>
        )}
        {c.configured && <Counts s={c.last7d} />}
        <div className="flex flex-wrap gap-2">
          {c.appUrl && <a href={c.appUrl} target="_blank" rel="noreferrer"><Button variant="secondary" type="button">Open {c.label}</Button></a>}
          {c.configured && <Button variant="secondary" onClick={onBackfill}>Sync existing {c.name === 'twenty' ? 'leads' : 'tickets'}</Button>}
          {c.configured && <Button variant="ghost" onClick={onShowLog}>Delivery log</Button>}
        </div>
      </div>
    </Card>
  );
}

function EndpointForm({ eventTypes, initial, submitLabel, onSubmit, onCancel }: {
  eventTypes: string[];
  initial?: { name: string; url: string; events: string[] };
  submitLabel: string;
  onSubmit: (v: { name: string; url: string; events: string[] }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial ?? { name: '', url: '', events: [] as string[] });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try { await onSubmit(v); } finally { setBusy(false); }
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name"><Input required maxLength={80} placeholder="e.g. Zapier, our ERP" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="URL" hint="We POST JSON here. Use https outside your own network.">
          <Input required type="url" placeholder="https://example.com/webhooks/audiobots" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
        </Field>
      </div>
      <EventPicker all={eventTypes} value={v.events} onChange={(events) => setV({ ...v, events })} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function DeliveryLog({ endpoints, filter, setFilter, refreshKey }: {
  endpoints: Endpoint[];
  filter: { target: string; status: string };
  setFilter: (f: { target: string; status: string }) => void;
  refreshKey: number;
}) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Delivery | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const limit = 25;
  const target = filter.target;
  const { data, error, reload } = useList<Delivery>('/v1/integrations/deliveries', {
    limit, offset,
    status: filter.status || undefined,
    connector: target === 'twenty' || target === 'chatwoot' ? target : undefined,
    endpointId: target && target !== 'twenty' && target !== 'chatwoot' ? target : undefined,
  });
  useEffect(() => { reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset(0); }, [filter.target, filter.status]);
  // Keep the log live while something is queued or retrying soon.
  const busy = data?.items.some((d) => d.status === 'sending' || (d.status === 'pending' && new Date(d.nextAttemptAt).getTime() - Date.now() < 60_000));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (d: Delivery) => {
    if (open === d.id) { setOpen(null); return; }
    setOpen(d.id);
    setDetail(null);
    setDetail(await adminApi<Delivery>(`/v1/integrations/deliveries/${d.id}`));
  };
  const retry = async (d: Delivery) => {
    setMsg(null);
    try {
      await adminApi(`/v1/integrations/deliveries/${d.id}/retry`, { method: 'POST' });
      setMsg('Queued again.');
      reload();
    } catch (e) { setMsg((e as Error).message); }
  };

  const targetName = (d: Delivery) => d.endpoint?.name ?? (d.connector === 'twenty' ? 'Twenty CRM' : d.connector === 'chatwoot' ? 'Chatwoot' : 'Deleted endpoint');

  return (
    <Card title="Delivery log" actions={<Button variant="ghost" onClick={reload}>Refresh</Button>}>
      <div className="mb-3 grid gap-2 sm:grid-cols-[16rem_12rem]">
        <Select aria-label="Target" value={filter.target} onChange={(e) => setFilter({ ...filter, target: e.target.value })}>
          <option value="">All destinations</option>
          <option value="twenty">Twenty CRM</option>
          <option value="chatwoot">Chatwoot</option>
          {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Any status</option>
          <option value="failing">Retrying</option>
          <option value="dead">Failed</option>
          <option value="succeeded">Delivered</option>
          <option value="pending">Queued</option>
        </Select>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {msg && <div className="mb-3"><Notice>{msg}</Notice></div>}
      <Table head={['When', 'Event', 'Destination', 'Status', 'Attempts', 'Result']}
        empty={data && !data.items.length ? <EmptyRow text="Nothing sent yet. Events appear here as calls, leads and tickets change." /> : undefined}>
        {data?.items.map((d) => (
          <Fragment key={d.id}>
            <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => void toggle(d)}
              aria-expanded={open === d.id}>
              <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(d.createdAt)}</td>
              <td className="px-4 py-2.5"><code className="text-xs">{d.event?.type}</code></td>
              <td className="px-4 py-2.5">{targetName(d)}</td>
              <td className="px-4 py-2.5"><DeliveryStatus d={d} /></td>
              <td className="px-4 py-2.5 tabular-nums">{d.attempts}</td>
              <td className="max-w-xs truncate px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                {d.status === 'pending' && d.attempts > 0
                  ? `${d.lastError ?? 'failed'} · next try ${fmtDate(d.nextAttemptAt)}`
                  : d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : d.lastResponse ?? '')}
              </td>
            </tr>
            {open === d.id && (
              <tr>
                <td colSpan={6} className="bg-zinc-50 px-4 py-3 dark:bg-zinc-950">
                  {!detail ? <p className="text-sm text-zinc-500">Loading…</p> : (
                    <div className="space-y-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <span>Message id <code>msg_{detail.event?.id}</code></span>
                        {detail.endpoint && <span className="break-all">{detail.endpoint.url}</span>}
                        {detail.lastDurationMs != null && <span>{detail.lastDurationMs} ms</span>}
                        {detail.deliveredAt && <span>Delivered {fmtDate(detail.deliveredAt)}</span>}
                      </div>
                      {(detail.status === 'dead' || (detail.status === 'pending' && detail.attempts > 0)) && (
                        <Button variant="secondary" onClick={() => void retry(detail)}>Retry now</Button>
                      )}
                      {detail.lastResponse && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-zinc-500">Last response</p>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">{detail.lastResponse}</pre>
                        </div>
                      )}
                      <div>
                        <p className="mb-1 text-xs font-medium text-zinc-500">Payload</p>
                        <pre className="max-h-72 overflow-auto rounded border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">{JSON.stringify(detail.event?.payload, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
      {data && <div className="mt-3"><Pager offset={offset} limit={limit} total={data.total} onChange={setOffset} /></div>}
    </Card>
  );
}

const VERIFY_SNIPPET = `import { Webhook } from "standardwebhooks"; // npm i standardwebhooks (also on PyPI, Go, Ruby, PHP…)

const wh = new Webhook(process.env.AUDIOBOTS_WEBHOOK_SECRET); // whsec_…
app.post("/webhooks/audiobots", express.raw({ type: "application/json" }), (req, res) => {
  const event = wh.verify(req.body, req.headers); // throws if the signature or timestamp is wrong
  // event.type, event.data …  Use the webhook-id header to ignore duplicates.
  res.sendStatus(204);
});`;

export default function IntegrationsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'neutral'; text: string } | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState({ target: '', status: '' });
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => adminApi<Overview>('/v1/integrations').then(setOv)
    .catch((e) => setMsg({ tone: 'error', text: (e as Error).message })), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  const showLog = (target: string) => {
    setFilter({ target, status: '' });
    document.getElementById('delivery-log')?.scrollIntoView({ behavior: 'smooth' });
  };

  if (!ov) return msg ? <Notice tone="error">{msg.text}</Notice> : <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-zinc-500">
          Send calls, leads and tickets to your CRM, helpdesk or any system that accepts webhooks. Failed sends are retried
          {' '}{ov.retry.maxAttempts} times over about a day ({ov.retry.delaysSec.map(fmtDelay).join(', ')}).
        </p>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        {ov.connectors.map((c) => (
          <ConnectorCard key={c.name} c={c} onShowLog={() => showLog(c.name)}
            onBackfill={() => void run(async () => {
              const r = await adminApi<{ queued: number }>(`/v1/integrations/connectors/${c.name}/backfill`, { method: 'POST' });
              setMsg({ tone: 'success', text: r.queued ? `Queued ${r.queued} ${c.name === 'twenty' ? 'leads' : 'tickets'} for ${c.label}.` : `Everything is already in ${c.label}.` });
            })} />
        ))}
      </div>

      <Card title="Webhooks" actions={!adding && <Button onClick={() => { setAdding(true); setEditing(null); }}>Add endpoint</Button>}>
        <div className="space-y-4">
          {secret && (
            <Notice tone="success">
              <div className="space-y-2">
                <p>Signing secret for <strong>{secret.name}</strong>. Store it in the receiving system to verify requests.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-white px-2 py-1 text-xs dark:bg-zinc-900">{secret.value}</code>
                  <Copy text={secret.value} />
                  <Button variant="ghost" className="py-1" onClick={() => setSecret(null)}>Hide</Button>
                </div>
              </div>
            </Notice>
          )}

          {adding && (
            <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
              <EndpointForm eventTypes={ov.eventTypes} submitLabel="Add endpoint" onCancel={() => setAdding(false)}
                onSubmit={(v) => run(async () => {
                  const ep = await adminApi<Endpoint & { secret: string }>('/v1/integrations/webhooks', jsonInit('POST', v));
                  setAdding(false);
                  setSecret({ name: ep.name, value: ep.secret });
                }, 'Endpoint added. Send a test event to check it.')} />
            </div>
          )}

          {!ov.endpoints.length && !adding && (
            <p className="text-sm text-zinc-500">No endpoints yet. Add one to receive events at your own URL (Zapier, n8n, Make, your backend).</p>
          )}

          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {ov.endpoints.map((e) => (
              <li key={e.id} className="py-3">
                {editing === e.id ? (
                  <EndpointForm eventTypes={ov.eventTypes} submitLabel="Save" initial={{ name: e.name, url: e.url, events: e.events }}
                    onCancel={() => setEditing(null)}
                    onSubmit={(v) => run(async () => {
                      await adminApi(`/v1/integrations/webhooks/${e.id}`, jsonInit('PATCH', v));
                      setEditing(null);
                    }, 'Endpoint saved.')} />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.name}</span>
                        {e.enabled ? <Badge tone="green">Active</Badge> : <Badge>Paused</Badge>}
                      </div>
                      <p className="break-all text-sm text-zinc-600 dark:text-zinc-400">{e.url}</p>
                      <p className="text-xs text-zinc-500">
                        {e.events.length ? e.events.join(', ') : 'All events'}
                      </p>
                      <Counts s={e.last7d} />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="secondary" disabled={!e.enabled} title={e.enabled ? undefined : 'Resume the endpoint first'}
                        onClick={() => void run(() => adminApi(`/v1/integrations/webhooks/${e.id}/test`, { method: 'POST' }), `Test event sent to ${e.name}. Its result shows in the delivery log.`).then(() => showLog(e.id))}>
                        Send test
                      </Button>
                      <Button variant="ghost" onClick={() => { setEditing(e.id); setAdding(false); }}>Edit</Button>
                      <Button variant="ghost" onClick={() => void run(async () => {
                        const r = await adminApi<{ secret: string }>(`/v1/integrations/webhooks/${e.id}/secret`);
                        setSecret({ name: e.name, value: r.secret });
                      })}>Secret</Button>
                      <Button variant="ghost" onClick={() => {
                        if (!confirm(`Create a new signing secret for ${e.name}? Requests are signed with the new secret right away, so update the receiver too.`)) return;
                        void run(async () => {
                          const r = await adminApi<{ secret: string }>(`/v1/integrations/webhooks/${e.id}/rotate-secret`, { method: 'POST' });
                          setSecret({ name: e.name, value: r.secret });
                        }, 'New secret created.');
                      }}>Rotate secret</Button>
                      <Button variant="ghost" onClick={() => void run(() => adminApi(`/v1/integrations/webhooks/${e.id}`, jsonInit('PATCH', { enabled: !e.enabled })),
                        e.enabled ? `${e.name} paused. New events are not queued for it.` : `${e.name} resumed.`)}>
                        {e.enabled ? 'Pause' : 'Resume'}
                      </Button>
                      <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => {
                        if (confirm(`Delete ${e.name}? Its delivery history is deleted too.`)) {
                          void run(() => adminApi(`/v1/integrations/webhooks/${e.id}`, { method: 'DELETE' }), `${e.name} deleted.`);
                        }
                      }}>Delete</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <details className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <summary className="cursor-pointer font-medium">How receivers verify requests</summary>
            <div className="mt-3 space-y-2 text-zinc-600 dark:text-zinc-400">
              <p>
                Requests follow the <a className="underline" href="https://www.standardwebhooks.com" target="_blank" rel="noreferrer">Standard Webhooks</a> spec:
                a JSON body <code>{'{ type, timestamp, data }'}</code> and the headers <code>webhook-id</code>, <code>webhook-timestamp</code> and
                <code> webhook-signature</code> (HMAC-SHA256 of <code>id.timestamp.body</code> with the secret). Reply with any 2xx within 10 seconds.
                Retries reuse the same <code>webhook-id</code>, and events can arrive out of order, so use <code>timestamp</code>.
              </p>
              <pre className="overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">{VERIFY_SNIPPET}</pre>
            </div>
          </details>
        </div>
      </Card>

      <div id="delivery-log">
        <DeliveryLog endpoints={ov.endpoints} filter={filter} setFilter={setFilter} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
