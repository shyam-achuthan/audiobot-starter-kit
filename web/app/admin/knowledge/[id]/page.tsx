'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { AGENT_LABELS, Badge, Button, Card, Field, Input, Notice, Textarea, adminApi, jsonInit } from '../../_ui';

type Doc = {
  id: string;
  type: 'file' | 'faq' | 'url';
  title: string;
  source: string | null;
  bytes: number | null;
  answer: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error: string | null;
  chunkCount: number;
  createdAt: string;
};

type Kb = {
  id: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  workflows: string[];
  documents: Doc[];
};

type Hit = { content: string; score: number; title: string; type: string; source: string | null };

const STATUS_TONE = { pending: 'amber', processing: 'blue', ready: 'green', error: 'red' } as const;
const TYPE_LABEL = { file: 'File', faq: 'FAQ', url: 'Web page' } as const;

function fmtBytes(n: number | null) {
  if (!n) return '';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function KnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [kb, setKb] = useState<Kb | null>(null);
  const [tab, setTab] = useState<'files' | 'faq' | 'url'>('files');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [faq, setFaq] = useState({ question: '', answer: '' });
  const [url, setUrl] = useState({ url: '', maxPages: 50 });
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () => adminApi<Kb>(`/v1/knowledge/${id}`).then(setKb).catch((e) => setMsg({ tone: 'error', text: e.message })),
    [id],
  );
  useEffect(() => void load(), [load]);

  // Poll while anything is still indexing.
  const indexing = kb?.documents.some((d) => d.status === 'pending' || d.status === 'processing');
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [indexing, load]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ tone: 'success', text: await fn() });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const upload = (files: FileList | File[]) => run(async () => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    const res = await adminApi<{ file: string; ok: boolean; error?: string }[]>(`/v1/knowledge/${id}/files`, {
      method: 'POST', body: form,
    });
    const failed = res.filter((r) => !r.ok);
    if (failed.length) throw new Error(failed.map((f) => `${f.file}: ${f.error}`).join(' · '));
    return `${res.length} file${res.length === 1 ? '' : 's'} added. Indexing…`;
  });

  const search = async () => {
    if (!query.trim()) return;
    setHits(null);
    try {
      const res = await adminApi<{ results: Hit[] }>('/v1/knowledge/search', jsonInit('POST', { query, kbIds: [id], topK: 5 }));
      setHits(res.results);
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  if (!kb) return <p className="text-sm text-zinc-500">{msg?.text ?? 'Loading…'}</p>;
  const ready = kb.documents.filter((d) => d.status === 'ready').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/knowledge" className="text-sm text-zinc-500 hover:underline">← Knowledge</Link>
          <h1 className="mt-1 text-2xl font-semibold">{kb.name}</h1>
          <p className="text-sm text-zinc-500">
            {ready} of {kb.documents.length} sources ready · used by {kb.workflows.map((w) => AGENT_LABELS[w] ?? w).join(', ')} · {kb.embeddingModel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy || !kb.documents.length} onClick={() => void run(async () => {
            const r = await adminApi<{ queued: number }>(`/v1/knowledge/${id}/reindex`, { method: 'POST' });
            return `Re-indexing ${r.queued} source(s)…`;
          })}>Re-index</Button>
          <Button variant="danger" disabled={busy} onClick={async () => {
            if (!confirm(`Delete "${kb.name}" and all its sources? This cannot be undone.`)) return;
            await adminApi(`/v1/knowledge/${id}`, { method: 'DELETE' });
            window.location.href = '/admin/knowledge';
          }}>Delete</Button>
        </div>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="Add knowledge">
        <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
          {([['files', 'Upload files'], ['faq', 'FAQ'], ['url', 'Website']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 ${tab === t ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-600 dark:text-zinc-400'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'files' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
            className={`rounded-lg border-2 border-dashed p-8 text-center transition ${dragging ? 'border-zinc-500 bg-zinc-50 dark:bg-zinc-800' : 'border-zinc-300 dark:border-zinc-700'}`}
          >
            <p className="text-sm font-medium">Drop files here</p>
            <p className="mt-1 text-xs text-zinc-500">PDF, Word (.docx), text or Markdown · up to 15 MB each</p>
            <input ref={fileInput} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown" className="hidden"
              onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />
            <Button variant="secondary" className="mt-4" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Uploading…' : 'Choose files'}
            </Button>
          </div>
        )}

        {tab === 'faq' && (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await adminApi(`/v1/knowledge/${id}/faqs`, jsonInit('POST', faq));
              setFaq({ question: '', answer: '' });
              return 'FAQ added.';
            });
          }}>
            <Field label="Question"><Input value={faq.question} required placeholder="Do you offer a free trial?" onChange={(e) => setFaq({ ...faq, question: e.target.value })} /></Field>
            <Field label="Answer" hint="Short, spoken-style answers work best on calls."><Textarea value={faq.answer} required placeholder="Yes, every plan has a 14-day free trial, no card needed." onChange={(e) => setFaq({ ...faq, answer: e.target.value })} /></Field>
            <Button type="submit" disabled={busy}>Add FAQ</Button>
          </form>
        )}

        {tab === 'url' && (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await adminApi<{ added: number; skippedExisting: number }>(`/v1/knowledge/${id}/urls`, jsonInit('POST', url));
              setUrl({ ...url, url: '' });
              return `${r.added} page(s) queued${r.skippedExisting ? `, ${r.skippedExisting} already indexed` : ''}.`;
            });
          }}>
            <Field label="Page or sitemap URL" hint="A single page, or a sitemap.xml to index many pages at once. Public sites only.">
              <Input type="url" value={url.url} required placeholder="https://example.com/pricing" onChange={(e) => setUrl({ ...url, url: e.target.value })} />
            </Field>
            <Field label="Max pages from a sitemap">
              <Input type="number" min={1} max={200} value={url.maxPages} className="w-32" onChange={(e) => setUrl({ ...url, maxPages: Number(e.target.value) })} />
            </Field>
            <Button type="submit" disabled={busy}>Add</Button>
          </form>
        )}
      </Card>

      <Card title={`Sources (${kb.documents.length})`}>
        {kb.documents.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing yet. Add files, FAQs or web pages above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr><th className="pb-2 pr-3">Source</th><th className="pb-2 pr-3">Type</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3 text-right">Chunks</th><th className="pb-2" /></tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {kb.documents.map((d) => (
                  <tr key={d.id} className="align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-xs text-zinc-500">
                        {d.type === 'faq' ? d.answer?.slice(0, 90) : [d.type === 'url' ? d.source : d.source, fmtBytes(d.bytes)].filter(Boolean).join(' · ')}
                      </div>
                      {d.error && <div className="mt-1 text-xs text-red-600">{d.error}</div>}
                    </td>
                    <td className="py-2 pr-3"><Badge>{TYPE_LABEL[d.type]}</Badge></td>
                    <td className="py-2 pr-3"><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.chunkCount}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {d.status === 'error' && (
                        <Button variant="ghost" onClick={() => void run(async () => {
                          await adminApi(`/v1/knowledge/${id}/documents/${d.id}/retry`, { method: 'POST' });
                          return 'Retrying…';
                        })}>Retry</Button>
                      )}
                      <Button variant="ghost" onClick={() => void run(async () => {
                        await adminApi(`/v1/knowledge/${id}/documents/${d.id}`, { method: 'DELETE' });
                        return `Removed "${d.title}".`;
                      })}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Test search">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <Input value={query} placeholder="Ask anything, in any language, e.g. रिफंड पॉलिसी क्या है?" onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={!query.trim()}>Search</Button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">This is what agents see when they search. Agents only use results scoring 0.45 or higher.</p>
        {hits && (
          <ul className="mt-4 space-y-3">
            {hits.length === 0 && <li className="text-sm text-zinc-500">No results.</li>}
            {hits.map((h, i) => (
              <li key={i} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <Badge tone={h.score >= 0.45 ? 'green' : 'neutral'}>{h.score.toFixed(3)}</Badge>
                  <span className="font-medium">{h.title}</span>
                  <span className="text-zinc-500">{TYPE_LABEL[h.type as Doc['type']] ?? h.type}</span>
                </div>
                <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{h.content}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
