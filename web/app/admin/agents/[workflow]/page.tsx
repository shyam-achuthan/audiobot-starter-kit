'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { AGENT_LABELS, Badge, Button, Card, Field, Input, Notice, Select, Textarea, adminApi, jsonInit } from '../../_ui';
import type { AgentFields, AgentOptions, AgentView } from '../_types';

type Draft = { [K in keyof AgentFields]: AgentFields[K] | undefined };
const KEYS: (keyof AgentFields)[] = [
  'role', 'greeting', 'llmModel', 'ttsSpeaker', 'ttsPace',
  'endpointingMinDelay', 'endpointingMaxDelay', 'allowInterruptions', 'interruptionMinDuration',
  'recordingConsent',
];

/** "Default" marker + reset link shown next to each field label. */
function FieldState({ custom, onReset }: { custom: boolean; onReset: () => void }) {
  return custom ? (
    <span className="ml-2 inline-flex items-center gap-2 text-xs font-normal">
      <Badge tone="blue">Customized</Badge>
      <button type="button" className="text-zinc-500 underline hover:text-zinc-900 dark:hover:text-white" onClick={onReset}>
        Use default
      </button>
    </span>
  ) : <span className="ml-2 text-xs font-normal text-zinc-400">Default</span>;
}

function NumberField({ label, hint, value, min, max, step, onChange, state }: {
  label: string; hint: string; value: number | undefined; min: number; max: number; step: number;
  onChange: (v: number) => void; state: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}{state}</span>
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} step={step} value={value ?? min} className="w-full accent-zinc-900 dark:accent-white"
          onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
        <Input type="number" min={min} max={max} step={step} value={value ?? ''} className="w-24 tabular-nums"
          onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} aria-label={`${label} value`} />
      </div>
      <span className="block text-xs text-zinc-500">{hint}</span>
    </label>
  );
}

export default function AgentEditPage({ params }: { params: Promise<{ workflow: string }> }) {
  const { workflow } = use(params);
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (a: AgentView) => {
    setAgent(a);
    setDraft(Object.fromEntries(KEYS.map((k) => [k, a.effective[k]])) as Draft);
  };

  useEffect(() => {
    adminApi<AgentView>(`/v1/agents/${workflow}`).then(load).catch((e) => setMsg({ tone: 'error', text: e.message }));
    adminApi<AgentOptions>('/v1/agents/options').then(setOptions).catch(() => undefined);
  }, [workflow]);

  // Fields whose draft differs from the saved effective value.
  const changes = useMemo(() => {
    if (!agent || !draft) return {};
    const out: Partial<Record<keyof AgentFields, unknown>> = {};
    for (const k of KEYS) {
      if (draft[k] === agent.effective[k]) continue;
      // Back to the default value = remove the override.
      out[k] = draft[k] === agent.defaults[k] ? null : draft[k];
    }
    return out;
  }, [agent, draft]);
  const dirty = Object.keys(changes).length > 0;

  if (!agent || !draft) return msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null;

  const set = <K extends keyof AgentFields>(k: K, v: AgentFields[K] | undefined) => setDraft({ ...draft, [k]: v });
  const custom = (k: keyof AgentFields) => draft[k] !== agent.defaults[k];
  const reset = (k: keyof AgentFields) => set(k, agent.defaults[k] as never);
  const state = (k: keyof AgentFields) => <FieldState custom={custom(k)} onReset={() => reset(k)} />;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      load(await adminApi<AgentView>(`/v1/agents/${workflow}`, jsonInit('PUT', changes)));
      setMsg({ tone: 'success', text: 'Saved. The next call uses these settings.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!confirm(`Reset every ${AGENT_LABELS[workflow]} setting to its default?`)) return;
    try {
      load(await adminApi<AgentView>(`/v1/agents/${workflow}/overrides`, { method: 'DELETE' }));
      setMsg({ tone: 'success', text: 'All settings are back to their defaults.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  const speakers = options?.ttsSpeakers ?? [];
  const groups = ['female', 'male', undefined].map((g) => ({ g, list: speakers.filter((s) => s.gender === g) })).filter((x) => x.list.length);
  const models = options?.llmModels.length ? options.llmModels : [draft.llmModel ?? 'agent-fast'];

  return (
    <div className="space-y-6 pb-20">
      <div>
        <Link href="/admin/agents" className="text-sm text-zinc-500 hover:underline">← Agents</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{AGENT_LABELS[workflow] ?? workflow}</h1>
          {Object.keys(agent.overrides).length > 0 && <Button variant="ghost" onClick={() => void resetAll()}>Reset all to defaults</Button>}
        </div>
      </div>

      <Card title="Instructions">
        <div className="space-y-4">
          <Field label="Role and rules" hint="What this agent does and how it uses its tools. The business profile, language rules and voice rules are added automatically.">
            <span className="-mt-1 block">{state('role')}</span>
            <Textarea value={draft.role ?? ''} className="min-h-64 font-mono text-xs leading-relaxed" onChange={(e) => set('role', e.target.value)} />
          </Field>
          <Field label="Greeting" hint="Instruction for the first thing the agent says. It speaks it in the caller's language.">
            <span className="-mt-1 block">{state('greeting')}</span>
            <Textarea value={draft.greeting ?? ''} className="min-h-16" onChange={(e) => set('greeting', e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Model">
          <Field label="LLM" hint="Aliases from infra/litellm/config.yaml. agent-fast (Gemini 3.5 Flash, thinking off) is the fastest with tools.">
            <span className="-mt-1 block">{state('llmModel')}</span>
            <Select value={draft.llmModel ?? ''} onChange={(e) => set('llmModel', e.target.value)}>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
        </Card>
        <Card title="Voice">
          <div className="space-y-4">
            <Field label="Speaker" hint={options?.ttsModel ? `Sarvam ${options.ttsModel} voices. Every voice speaks all six languages.` : undefined}>
              <span className="-mt-1 block">{state('ttsSpeaker')}</span>
              <Select value={draft.ttsSpeaker ?? ''} onChange={(e) => set('ttsSpeaker', e.target.value)}>
                {!speakers.some((s) => s.id === draft.ttsSpeaker) && <option value={draft.ttsSpeaker}>{draft.ttsSpeaker}</option>}
                {groups.map(({ g, list }) => (
                  <optgroup key={g ?? 'other'} label={g ? g[0].toUpperCase() + g.slice(1) : 'Other'}>
                    {list.map((s) => <option key={s.id} value={s.id}>{s.id[0].toUpperCase() + s.id.slice(1)}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <NumberField label="Speaking pace" hint="1.0 is normal. 0.9–1.15 sounds natural on calls."
              value={draft.ttsPace} min={0.5} max={2} step={0.05} onChange={(v) => set('ttsPace', v)} state={state('ttsPace')} />
          </div>
        </Card>
      </div>

      <Card title="Call recording">
        <Field label={<>Recording consent{state('recordingConsent')}</>}
          hint="Applies to calls this agent answers. Recordings need the recording profile (make up-rec); retention is set on the Setup page.">
          <Select value={draft.recordingConsent ?? 'notice'} onChange={(e) => set('recordingConsent', e.target.value as AgentFields['recordingConsent'])}>
            <option value="notice">Tell the caller, record unless they object</option>
            <option value="ask">Ask first, record only after a yes</option>
            <option value="off">Don't record</option>
          </Select>
        </Field>
      </Card>

      <Card title="Turn timing (advanced)">
        <div className="grid gap-6 lg:grid-cols-2">
          <NumberField label="Minimum end-of-turn delay (s)" hint="Silence before the agent may reply when the caller sounds finished. Lower is snappier but may cut people off."
            value={draft.endpointingMinDelay} min={0.1} max={3} step={0.05} onChange={(v) => set('endpointingMinDelay', v)} state={state('endpointingMinDelay')} />
          <NumberField label="Maximum end-of-turn delay (s)" hint="Longest wait when the caller sounds mid-sentence (English and Hindi only)."
            value={draft.endpointingMaxDelay} min={0.3} max={6} step={0.1} onChange={(v) => set('endpointingMaxDelay', v)} state={state('endpointingMaxDelay')} />
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={draft.allowInterruptions ?? true} onChange={(e) => set('allowInterruptions', e.target.checked)} />
            <span>
              <span className="text-sm font-medium">Caller can interrupt the agent{state('allowInterruptions')}</span>
              <span className="block text-xs text-zinc-500">Turn off only for messages that must be heard in full.</span>
            </span>
          </label>
          <NumberField label="Minimum interruption (s)" hint="How long the caller must speak to interrupt. Applies to the whole call when this agent answers it."
            value={draft.interruptionMinDuration} min={0.1} max={2} step={0.05} onChange={(v) => set('interruptionMinDuration', v)} state={state('interruptionMinDuration')} />
        </div>
      </Card>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border border-zinc-200 bg-white/90 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <span className="mr-auto text-sm text-zinc-500">{dirty ? `${Object.keys(changes).length} unsaved change${Object.keys(changes).length > 1 ? 's' : ''}` : 'No unsaved changes'}</span>
        <Button variant="secondary" disabled={!dirty || saving} onClick={() => load(agent)}>Discard</Button>
        <Button disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  );
}
