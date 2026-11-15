'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  AGENT_LABELS, Badge, Button, Card, LANGUAGE_LABELS, Notice, OUTCOME_LABELS, PRIORITY_TONES, TICKET_STATUS_LABELS,
  adminApi, fmtDate, fmtDuration, fmtMs, outcomeTone,
} from '../../_ui';

type Turn = {
  turnNo: number; agent: string | null; language: string | null; userText: string | null; agentText: string | null;
  interrupted: boolean; eotMs: number | null; sttMs: number | null; llmTtftMs: number | null; ttsTtfbMs: number | null;
  e2eMs: number | null;
};
type CallDetail = {
  id: string; room: string; channel: string; startedAt: string; endedAt: string | null; status: string;
  outcome: string | null; agentPath: string[]; language: string | null; callerName: string | null;
  callerPhone: string | null; callerEmail: string | null; turnCount: number; medianE2eMs: number | null;
  turns: Turn[];
  leads: { id: string; name: string | null; score: number | null; status: string }[];
  tickets: { id: string; ref: string; subject: string; type: string; priority: string; status: string }[];
  recording: Recording;
  traceUrl: string | null;
  direction: 'inbound' | 'outbound'; remoteNumber: string | null; localNumber: string | null;
  dialStatus: string | null; dialError: string | null;
  transcriptPurgedAt: string | null;
};
type Recording = {
  status: 'none' | 'recording' | 'processing' | 'ready' | 'declined' | 'failed' | 'unavailable' | 'deleted' | 'expired';
  consent: 'off' | 'notice' | 'ask' | null;
  durationMs: number | null; bytes: number | null; error: string | null; audioPath: string | null;
};

const RECORDING_TEXT: Record<Recording['status'], string> = {
  none: 'This call was not recorded.',
  recording: 'Recording in progress.',
  processing: 'Recording finished; the file is being saved.',
  ready: '',
  declined: 'The caller declined recording, so nothing was kept.',
  failed: 'Recording failed.',
  unavailable: 'Recording was not available for this call.',
  deleted: 'The recording was deleted by an owner.',
  expired: 'The recording was removed by the retention policy (Admin → Setup).',
};
const CONSENT_TEXT: Record<string, string> = {
  off: 'Recording off for this agent', notice: 'Caller was told and could opt out', ask: 'Caller agreed when asked',
};

const SLOW_MS = 3000;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return '';
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function RecordingCard({ call, owner, onChange }: { call: CallDetail; owner: boolean; onChange: () => void }) {
  const r = call.recording;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!confirm('Delete this recording permanently? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(`/v1/calls/${call.id}/recording`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Recording"
      actions={r.status === 'ready' && owner
        ? <Button variant="danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete recording'}</Button>
        : undefined}
    >
      {r.status === 'ready' && r.audioPath ? (
        <div className="space-y-2">
          {/* Streams through the signed-in admin proxy; supports seeking. */}
          <audio controls preload="metadata" className="w-full" src={`/admin-api${r.audioPath}`} />
          <p className="text-xs text-zinc-500">
            {[r.durationMs != null ? fmtDuration(new Date(0).toISOString(), new Date(r.durationMs).toISOString()) : null,
              fmtSize(r.bytes), 'OGG/Opus', r.consent ? CONSENT_TEXT[r.consent] : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {RECORDING_TEXT[r.status]}
          {r.error && <span className="ml-1 text-zinc-500">({r.error})</span>}
        </p>
      )}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
    </Card>
  );
}

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const load = () => adminApi<CallDetail>(`/v1/calls/${id}`).then(setCall).catch((e) => setError(e.message));

  useEffect(() => {
    adminApi<{ role: string }>('/v1/auth/me').then((me) => setOwner(me.role === 'owner')).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    // Live calls (and recordings still being saved): refresh every few seconds.
    const t = setInterval(() => {
      if (call?.status === 'active' || ['recording', 'processing'].includes(call?.recording.status ?? '')) void load();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, call?.status, call?.recording.status]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!call) return null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/calls" className="text-sm text-zinc-500 hover:underline">← Calls</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{call.callerName ?? 'Unknown caller'}</h1>
          {call.status === 'active'
            ? <Badge tone="blue">Live</Badge>
            : <Badge tone={outcomeTone(call.outcome)}>{OUTCOME_LABELS[call.outcome ?? 'unknown']}</Badge>}
        </div>
      </div>

      <Card>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Info label="Started">{fmtDate(call.startedAt)}</Info>
          <Info label="Duration">{fmtDuration(call.startedAt, call.endedAt)}</Info>
          <Info label={call.channel === 'sip' ? (call.direction === 'outbound' ? 'Phone call to' : 'Phone call from') : 'Phone'}>
            <span className="tabular-nums">{call.callerPhone ?? call.remoteNumber ?? '—'}</span>
            {call.channel === 'sip' && call.localNumber && <span className="block text-xs text-zinc-500">via {call.localNumber}</span>}
          </Info>
          <Info label="Language">{call.language ? LANGUAGE_LABELS[call.language] ?? call.language : '—'}</Info>
          <Info label="Agents">{call.agentPath.map((a) => AGENT_LABELS[a] ?? a).join(' → ')}</Info>
          <Info label="Median reply"><span className="tabular-nums">{fmtMs(call.medianE2eMs)}</span></Info>
        </dl>
        {call.dialStatus && !['answered', 'dialing'].includes(call.dialStatus) && (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
            Not connected: {({ no_answer: 'no answer', busy: 'busy', failed: 'the call failed', blocked: 'blocked' } as Record<string, string>)[call.dialStatus] ?? call.dialStatus}
            {call.dialError && <span className="text-zinc-500"> ({call.dialError})</span>}
          </p>
        )}
        {call.traceUrl && (
          <p className="mt-4 text-sm">
            <a href={call.traceUrl} target="_blank" rel="noreferrer" className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
              Open LLM trace in Langfuse ↗
            </a>
          </p>
        )}
        {(call.leads.length > 0 || call.tickets.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
            {call.leads.map((l) => (
              <Link key={l.id} href={`/admin/leads/${l.id}`} className="rounded-md border border-zinc-200 px-2.5 py-1 hover:border-zinc-400 dark:border-zinc-700">
                Lead · {l.name ?? 'unnamed'}{l.score != null ? ` · score ${l.score}` : ''}
              </Link>
            ))}
            {call.tickets.map((t) => (
              <Link key={t.id} href={`/admin/tickets/${t.ref}`} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1 hover:border-zinc-400 dark:border-zinc-700">
                {t.ref} · {t.type === 'callback' ? 'Callback' : 'Support'} · {TICKET_STATUS_LABELS[t.status]}
                <Badge tone={PRIORITY_TONES[t.priority]}>{t.priority}</Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <RecordingCard call={call} owner={owner} onChange={load} />

      <Card title="Transcript">
        {call.transcriptPurgedAt && (
          <p className="mb-3 text-sm text-zinc-500">Transcript text was removed by the retention policy on {fmtDate(call.transcriptPurgedAt)}.</p>
        )}
        {call.turns.length === 0 && <p className="text-sm text-zinc-500">No turns recorded.</p>}
        <ol className="space-y-4">
          {call.turns.map((t) => (
            <li key={t.turnNo} className="space-y-2">
              {t.userText && (
                <div className="flex justify-end">
                  <p className="max-w-[80%] rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">{t.userText}</p>
                </div>
              )}
              {t.agentText && (
                <div>
                  <p className="max-w-[80%] rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                    {t.agentText}
                    {t.interrupted && <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">(interrupted)</span>}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {AGENT_LABELS[t.agent ?? ''] ?? t.agent}
                    {t.e2eMs != null && (
                      <> · replied in <span className={`tabular-nums ${t.e2eMs > SLOW_MS ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>{fmtMs(t.e2eMs)}</span></>
                    )}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Latency per turn">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>{['Turn', 'End of turn', 'Speech to text', 'LLM first token', 'TTS first audio', 'Voice to voice'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {call.turns.map((t) => (
                <tr key={t.turnNo} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1.5">{t.turnNo}</td>
                  <td className="px-2 py-1.5">{fmtMs(t.eotMs)}</td>
                  <td className="px-2 py-1.5">{fmtMs(t.sttMs)}</td>
                  <td className="px-2 py-1.5">{fmtMs(t.llmTtftMs)}</td>
                  <td className="px-2 py-1.5">{fmtMs(t.ttsTtfbMs)}</td>
                  <td className={`px-2 py-1.5 ${t.e2eMs != null && t.e2eMs > SLOW_MS ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>{fmtMs(t.e2eMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">Replies slower than 3 s are highlighted.</p>
      </Card>
    </div>
  );
}
