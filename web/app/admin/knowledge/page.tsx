'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AGENT_LABELS, Badge, Button, Card, Field, Input, Notice, Textarea, adminApi, jsonInit } from '../_ui';

type Kb = {
  id: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  dimension: number;
  workflows: string[];
  documentCount: number;
  chunkCount: number;
  byStatus: Record<string, number>;
};

export default function KnowledgeListPage() {
  const [kbs, setKbs] = useState<Kb[] | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [form, setForm] = useState({ name: '', description: '', embeddingModel: 'embed-gemini', workflows: Object.keys(AGENT_LABELS) });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => adminApi<Kb[]>('/v1/knowledge').then(setKbs).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    adminApi<{ models: string[] }>('/v1/knowledge/embedding-models').then((d) => setModels(d.models)).catch(() => undefined);
  }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const kb = await adminApi<{ id: string }>('/v1/knowledge', jsonInit('POST', {
        ...form, description: form.description || undefined,
      }));
      window.location.href = `/admin/knowledge/${kb.id}`;
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge</h1>
        <p className="text-sm text-zinc-500">What the voice agents know: documents, FAQs and website pages, searched during calls.</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        {kbs?.map((kb) => (
          <Link key={kb.id} href={`/admin/knowledge/${kb.id}`} className="block">
            <Card className="h-full transition hover:border-zinc-400 dark:hover:border-zinc-600">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{kb.name}</h2>
                  {kb.description && <p className="mt-1 text-sm text-zinc-500">{kb.description}</p>}
                </div>
                <span className="text-zinc-400">→</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="green">{kb.byStatus.ready ?? 0} ready</Badge>
                {(kb.byStatus.pending ?? 0) + (kb.byStatus.processing ?? 0) > 0 && (
                  <Badge tone="amber">{(kb.byStatus.pending ?? 0) + (kb.byStatus.processing ?? 0)} indexing</Badge>
                )}
                {kb.byStatus.error ? <Badge tone="red">{kb.byStatus.error} failed</Badge> : null}
                <Badge>{kb.chunkCount} chunks</Badge>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                Used by: {kb.workflows.map((w) => AGENT_LABELS[w] ?? w).join(', ')} · {kb.embeddingModel}
              </p>
            </Card>
          </Link>
        ))}
        {kbs && kbs.length === 0 && (
          <Card><p className="text-sm text-zinc-500">No knowledge bases yet. Create one to start adding documents.</p></Card>
        )}
      </div>

      <Card title="New knowledge base">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={form.name} placeholder="Product docs" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Embedding model" hint="How text is turned into searchable vectors. Changing it later re-indexes everything.">
            <select
              value={form.embeddingModel}
              onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {(models.length ? models : ['embed-gemini']).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description (optional)">
              <Textarea value={form.description} className="min-h-16" onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <span className="text-sm font-medium">Agents that can use it</span>
            <div className="flex flex-wrap gap-4">
              {Object.entries(AGENT_LABELS).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.workflows.includes(id)}
                    onChange={(e) => setForm({
                      ...form,
                      workflows: e.target.checked ? [...form.workflows, id] : form.workflows.filter((w) => w !== id),
                    })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <Button className="mt-4" disabled={!form.name.trim() || !form.workflows.length || creating} onClick={() => void create()}>
          {creating ? 'Creating…' : 'Create knowledge base'}
        </Button>
      </Card>
    </div>
  );
}
