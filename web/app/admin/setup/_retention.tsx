'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Notice, adminApi, jsonInit } from '../_ui';

type Retention = { recordingRetentionDays: number | null; transcriptRetentionDays: number | null };
type Draft = { recording: string; transcript: string }; // '' = keep forever

const toDraft = (r: Retention): Draft => ({
  recording: r.recordingRetentionDays?.toString() ?? '',
  transcript: r.transcriptRetentionDays?.toString() ?? '',
});

function parse(v: string): number | null | 'bad' {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 'bad';
}

/** Org-wide retention for call recordings and transcripts. Owners can change it. */
export function RetentionCard() {
  const [saved, setSaved] = useState<Retention | null>(null);
  const [draft, setDraft] = useState<Draft>({ recording: '', transcript: '' });
  const [owner, setOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    adminApi<Retention>('/v1/settings/retention').then((r) => { setSaved(r); setDraft(toDraft(r)); })
      .catch((e) => setMsg({ tone: 'error', text: e.message }));
    adminApi<{ role: string }>('/v1/auth/me').then((me) => setOwner(me.role === 'owner')).catch(() => undefined);
  }, []);

  const rec = parse(draft.recording);
  const tx = parse(draft.transcript);
  const dirty = saved != null && (draft.recording !== toDraft(saved).recording || draft.transcript !== toDraft(saved).transcript);

  const save = async () => {
    if (rec === 'bad' || tx === 'bad') return;
    const shorter = (next: number | null, prev: number | null) => next != null && (prev == null || next < prev);
    if ((shorter(rec, saved!.recordingRetentionDays) || shorter(tx, saved!.transcriptRetentionDays))
      && !confirm('Older recordings or transcripts will be deleted right away and cannot be recovered. Continue?')) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await adminApi<Retention>('/v1/settings/retention',
        jsonInit('PUT', { recordingRetentionDays: rec, transcriptRetentionDays: tx }));
      setSaved(r);
      setDraft(toDraft(r));
      setMsg({ tone: 'success', text: 'Retention saved.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const hint = (v: number | null | 'bad', what: string) =>
    v === 'bad' ? 'Enter whole days between 1 and 3650, or leave empty.'
      : v == null ? `Leave empty to keep ${what} forever.`
        : `${what[0].toUpperCase()}${what.slice(1)} older than ${v} day${v === 1 ? '' : 's'} are deleted automatically.`;

  return (
    <Card title="Data retention">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        How long call data is kept. Leads, tickets and call details (time, outcome, latency) are always kept.
        {!owner && ' Only an owner can change this.'}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Keep call recordings (days)" hint={hint(rec, 'recordings')}>
          <Input inputMode="numeric" placeholder="Forever" value={draft.recording} disabled={!owner}
            onChange={(e) => setDraft({ ...draft, recording: e.target.value })} />
        </Field>
        <Field label="Keep transcript text (days)" hint={hint(tx, 'transcripts')}>
          <Input inputMode="numeric" placeholder="Forever" value={draft.transcript} disabled={!owner}
            onChange={(e) => setDraft({ ...draft, transcript: e.target.value })} />
        </Field>
      </div>
      {owner && (
        <div className="mt-4">
          <Button disabled={!dirty || saving || rec === 'bad' || tx === 'bad'} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save retention'}
          </Button>
        </div>
      )}
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}
