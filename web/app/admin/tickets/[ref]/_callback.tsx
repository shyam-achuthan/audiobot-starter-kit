'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, Input, Notice, adminApi, fmtDate, jsonInit } from '../../_ui';

export type CallbackTicket = {
  ref: string; type: string; status: string; contactPhone: string | null;
  callbackAt: string | null; callbackAttempts: number; lastCallbackAt: string | null;
};
type Block = { reason: string; message: string } | null;

/** "2026-11-16T10:30:00.000Z" -> "2026-11-16T16:00" in the browser's local time, for datetime-local. */
function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ticket page: call the customer now, and when the scheduler should call them back. */
export function CallbackCard({ ticket, onChange }: { ticket: CallbackTicket; onChange: (t: CallbackTicket) => void }) {
  const [block, setBlock] = useState<Block>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState(toLocalInput(ticket.callbackAt));
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string; callId?: string } | null>(null);

  const check = () => adminApi<{ blocked: Block }>(`/v1/calls/outbound/check?ticketRef=${encodeURIComponent(ticket.ref)}`)
    .then((r) => setBlock(r.blocked)).catch(() => setBlock(null)).finally(() => setChecked(true));
  useEffect(() => { void check(); }, [ticket.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const callNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminApi<{ callId: string }>('/v1/calls/outbound', jsonInit('POST', { ticketRef: ticket.ref }));
      setMsg({ tone: 'success', text: 'Calling now. The agent speaks once they pick up.', callId: r.callId });
      onChange({ ...ticket, callbackAttempts: ticket.callbackAttempts + 1, lastCallbackAt: new Date().toISOString() });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
      void check();
    }
  };

  const schedule = async (value: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      const t = await adminApi<CallbackTicket>(`/v1/tickets/${ticket.ref}`,
        jsonInit('PATCH', { callbackAt: value ? new Date(value).toISOString() : null }));
      onChange(t);
      setWhen(toLocalInput(t.callbackAt));
      setMsg({ tone: 'success', text: value ? 'Callback scheduled.' : 'Scheduled callback cleared.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const notConfigured = block?.reason === 'not_configured';
  return (
    <Card title="Phone">
      <div className="space-y-4 text-sm">
        <div>
          <Button onClick={() => void callNow()} disabled={busy || !checked || Boolean(block)}>
            {busy ? 'Working…' : 'Call now'}
          </Button>
          {block && <p className="mt-2 text-xs text-zinc-500">{block.message}{notConfigured && ' — see Admin → Phone'}</p>}
        </div>
        {ticket.type === 'callback' && (
          <div className="space-y-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <label className="block text-xs text-zinc-500" htmlFor="callback-at">Scheduled callback</label>
            <div className="flex flex-wrap gap-2">
              <Input id="callback-at" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-auto" />
              <Button variant="secondary" disabled={busy || !when || when === toLocalInput(ticket.callbackAt)} onClick={() => void schedule(when)}>Save</Button>
              {ticket.callbackAt && <Button variant="ghost" disabled={busy} onClick={() => void schedule(null)}>Clear</Button>}
            </div>
            <p className="text-xs text-zinc-500">
              {ticket.callbackAt
                ? ticket.status === 'open'
                  ? `The agent calls automatically at this time (within calling hours).`
                  : 'Not called automatically: the ticket is no longer open.'
                : 'No time set: the agent picks one up when the caller gives a time.'}
              {ticket.callbackAttempts > 0 && ` Attempts so far: ${ticket.callbackAttempts}${ticket.lastCallbackAt ? `, last ${fmtDate(ticket.lastCallbackAt)}` : ''}.`}
            </p>
          </div>
        )}
        {msg && (
          <Notice tone={msg.tone}>
            {msg.text}{msg.callId && <> <Link href={`/admin/calls/${msg.callId}`} className="underline">Open the call</Link></>}
          </Notice>
        )}
      </div>
    </Card>
  );
}
