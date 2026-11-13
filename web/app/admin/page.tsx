export const dynamic = 'force-dynamic';

type Health = {
  ok: boolean;
  services: Record<string, { ok: boolean; error?: string; [k: string]: unknown }>;
};

async function getHealth(): Promise<Health | { error: string }> {
  const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const r = await fetch(`${api}/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return (await r.json()) as Health;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export default async function AdminPage() {
  const health = await getHealth();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">System health</h2>
        {'error' in health ? (
          <p className="text-red-600">API unreachable: {health.error}</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {Object.entries(health.services).map(([name, s]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono">{name}</span>
                <span className={s.ok ? 'text-emerald-600' : 'text-red-600'}>
                  {s.ok ? 'healthy' : `down — ${s.error ?? 'unknown'}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-zinc-500">Agents, knowledge bases, calls and leads arrive in Phase 4.</p>
    </div>
  );
}
