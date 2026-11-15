'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AGENT_LABELS, Badge, Button, Card, Field, Input, Notice, Select, Textarea, adminApi, jsonInit,
} from '../_ui';

type Appearance = { title?: string; buttonLabel?: string; color?: string; position?: 'right' | 'left'; captions?: boolean };
type Widget = {
  id: string; name: string; publicKey: string; allowedOrigins: string[]; workflow: string; appearance: Appearance;
  maxConcurrent: number; maxMinutes: number; enabled: boolean;
};
type Draft = {
  name: string; origins: string; workflow: string; title: string; buttonLabel: string; color: string;
  position: 'right' | 'left'; captions: boolean; maxConcurrent: number; maxMinutes: number; enabled: boolean;
};

const WORKFLOWS = ['router', 'sales', 'support', 'lead_qualification'];
const EMPTY: Draft = {
  name: 'Website', origins: '', workflow: 'router', title: 'Talk to us', buttonLabel: 'Talk to us', color: '#18181b',
  position: 'right', captions: true, maxConcurrent: 5, maxMinutes: 15, enabled: true,
};

const toDraft = (w: Widget): Draft => ({
  name: w.name, origins: w.allowedOrigins.join('\n'), workflow: w.workflow,
  title: w.appearance.title ?? EMPTY.title, buttonLabel: w.appearance.buttonLabel ?? EMPTY.buttonLabel,
  color: w.appearance.color ?? EMPTY.color, position: w.appearance.position ?? 'right',
  captions: w.appearance.captions ?? true, maxConcurrent: w.maxConcurrent, maxMinutes: w.maxMinutes, enabled: w.enabled,
});
const toBody = (d: Draft) => ({
  name: d.name, workflow: d.workflow, enabled: d.enabled,
  allowedOrigins: d.origins.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
  appearance: { title: d.title, buttonLabel: d.buttonLabel, color: d.color, position: d.position, captions: d.captions },
  maxConcurrent: Number(d.maxConcurrent), maxMinutes: Number(d.maxMinutes),
});

function snippet(key: string) {
  return `<script src="${window.location.origin}/widget.js" data-key="${key}" async></script>`;
}

function Editor({ initial, onSave, onCancel, saving }: {
  initial: Draft; onSave: (d: Draft) => void; onCancel: () => void; saving: boolean;
}) {
  const [d, setD] = useState(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(d); }}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name"><Input required value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Answered by">
          <Select value={d.workflow} onChange={(e) => set('workflow', e.target.value)}>
            {WORKFLOWS.map((w) => <option key={w} value={w}>{AGENT_LABELS[w] ?? w}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Websites allowed to use it" hint="One per line: https://shop.example.com, or https://*.example.com for every subdomain. This dashboard is always allowed (for the preview).">
        <Textarea className="min-h-20 font-mono text-xs" placeholder={'https://www.example.com\nhttps://*.example.com'} value={d.origins} onChange={(e) => set('origins', e.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Panel title"><Input value={d.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Button label"><Input value={d.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} /></Field>
        <Field label="Colour">
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Widget colour" className="h-9 w-12 cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-zinc-700" value={d.color} onChange={(e) => set('color', e.target.value)} />
            <Input value={d.color} onChange={(e) => set('color', e.target.value)} className="font-mono text-xs" />
          </div>
        </Field>
        <Field label="Position">
          <Select value={d.position} onChange={(e) => set('position', e.target.value as Draft['position'])}>
            <option value="right">Bottom right</option>
            <option value="left">Bottom left</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Calls at the same time" hint="More callers see 'all assistants are busy'.">
          <Input type="number" min={1} max={100} value={d.maxConcurrent} onChange={(e) => set('maxConcurrent', Number(e.target.value))} />
        </Field>
        <Field label="Longest call (minutes)" hint="The assistant wraps up a minute before.">
          <Input type="number" min={1} max={60} value={d.maxMinutes} onChange={(e) => set('maxMinutes', Number(e.target.value))} />
        </Field>
        <div className="space-y-3 pt-6">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.captions} onChange={(e) => set('captions', e.target.checked)} /> Show live captions</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Widget on</label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save widget'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function WidgetCard({ w, reload }: { w: Widget; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setSaving(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      reload();
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(snippet(w.publicKey)).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card
      title={w.name}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {w.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
          <a href={`/widget-preview?key=${encodeURIComponent(w.publicKey)}`} target="_blank" rel="noreferrer"><Button variant="secondary">Preview</Button></a>
          {!editing && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      }
    >
      {editing ? (
        <Editor
          initial={toDraft(w)} saving={saving} onCancel={() => setEditing(false)}
          onSave={(d) => void run(() => adminApi(`/v1/widgets/${w.id}`, jsonInit('PUT', toBody(d))), 'Saved.').then((ok) => ok && setEditing(false))}
        />
      ) : (
        <div className="space-y-4 text-sm">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div><dt className="text-xs text-zinc-500">Answered by</dt><dd className="mt-0.5">{AGENT_LABELS[w.workflow] ?? w.workflow}</dd></div>
            <div><dt className="text-xs text-zinc-500">Limits</dt><dd className="mt-0.5">{w.maxConcurrent} at once · {w.maxMinutes} min per call</dd></div>
            <div><dt className="text-xs text-zinc-500">Look</dt><dd className="mt-0.5 flex items-center gap-2"><span className="inline-block h-4 w-4 rounded-full border border-zinc-300" style={{ background: w.appearance.color ?? '#18181b' }} />{w.appearance.buttonLabel ?? 'Talk to us'} · {w.appearance.position === 'left' ? 'left' : 'right'}{w.appearance.captions === false ? ' · no captions' : ' · captions'}</dd></div>
          </dl>
          <div>
            <p className="text-xs text-zinc-500">Allowed websites</p>
            {w.allowedOrigins.length
              ? <p className="mt-0.5 break-all font-mono text-xs">{w.allowedOrigins.join(', ')}</p>
              : <p className="mt-0.5 text-amber-700 dark:text-amber-400">None yet: the widget only works in the preview until you add a website.</p>}
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">Paste this before <code>&lt;/body&gt;</code> on your site</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="block flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{snippet(w.publicKey)}</code>
              <Button variant="secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <Button variant="ghost" disabled={saving} onClick={() => confirm('Make a new key? Sites using the old snippet stop working until you update them.') && void run(() => adminApi(`/v1/widgets/${w.id}/rotate-key`, { method: 'POST' }), 'New key made. Update the snippet on your sites.')}>New key</Button>
            <Button variant="ghost" disabled={saving} onClick={() => void run(() => adminApi(`/v1/widgets/${w.id}`, jsonInit('PUT', { enabled: !w.enabled })))}>{w.enabled ? 'Turn off' : 'Turn on'}</Button>
            <Button variant="danger" disabled={saving} onClick={() => confirm(`Delete "${w.name}"? Sites using it stop showing the widget.`) && void run(() => adminApi(`/v1/widgets/${w.id}`, { method: 'DELETE' }))}>Delete</Button>
          </div>
        </div>
      )}
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}

export default function WidgetsPage() {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    adminApi<Widget[]>('/v1/widgets').then(setWidgets).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const create = async (d: Draft) => {
    setSaving(true);
    setError(null);
    try {
      await adminApi('/v1/widgets', jsonInit('POST', toBody(d)));
      setCreating(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Website widgets</h1>
          <p className="text-sm text-zinc-500">A voice button for your website. Each widget only works on the sites you allow.</p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>New widget</Button>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {creating && (
        <Card title="New widget">
          <Editor initial={EMPTY} saving={saving} onSave={(d) => void create(d)} onCancel={() => setCreating(false)} />
        </Card>
      )}
      {widgets?.length === 0 && !creating && (
        <Card><p className="text-sm text-zinc-600 dark:text-zinc-400">No widgets yet. Create one, add your website, and paste the snippet into your pages.</p></Card>
      )}
      {widgets?.map((w) => <WidgetCard key={w.id} w={w} reload={reload} />)}
    </div>
  );
}
