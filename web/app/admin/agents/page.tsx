'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AGENT_LABELS, Badge, Card, Notice, adminApi, fmtDate } from '../_ui';
import { AGENT_BLURBS, type AgentView } from './_types';

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi<AgentView[]>('/v1/agents').then(setAgents).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-zinc-500">
          Change each agent&apos;s instructions, model, voice and timing. Changes apply to the next call; calls in progress keep their settings.
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {agents && agents.every((a) => !a.defaults.role) && (
        <Notice>The agent worker hasn&apos;t reported its defaults yet. Make sure the <code>agent</code> container is running, then reload.</Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {agents?.map((a) => {
          const changed = Object.keys(a.overrides).length;
          return (
            <Link key={a.workflow} href={`/admin/agents/${a.workflow}`} className="block">
              <Card className="h-full transition hover:border-zinc-400 dark:hover:border-zinc-600">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{AGENT_LABELS[a.workflow] ?? a.workflow}</h2>
                    <p className="mt-1 text-sm text-zinc-500">{AGENT_BLURBS[a.workflow]}</p>
                  </div>
                  <span className="text-zinc-400" aria-hidden>→</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge>{a.effective.llmModel ?? '—'}</Badge>
                  <Badge>voice: {a.effective.ttsSpeaker ?? '—'}</Badge>
                  {changed ? <Badge tone="blue">{changed} customized</Badge> : <Badge tone="green">Defaults</Badge>}
                </div>
                {changed > 0 && a.updatedBy && (
                  <p className="mt-3 text-xs text-zinc-500">Last changed by {a.updatedBy}, {fmtDate(a.updatedAt)}</p>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
