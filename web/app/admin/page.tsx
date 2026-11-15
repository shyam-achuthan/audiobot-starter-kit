import Link from 'next/link';

export const dynamic = 'force-dynamic';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const AUTH = { authorization: `Bearer ${process.env.AGENT_API_TOKEN ?? ''}` };

type Health = {
  ok: boolean;
  services: Record<string, { ok: boolean; error?: string; [k: string]: unknown }>;
};

async function get<T>(path: string, auth = false): Promise<T | { error: string }> {
  try {
    const r = await fetch(`${API}${path}`, {
      cache: 'no-store',
      headers: auth ? AUTH : undefined,
      signal: AbortSignal.timeout(4000),
    });
    return (await r.json()) as T;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export default async function AdminPage() {
  const [health, profile, kbs] = await Promise.all([
    get<Health>('/health'),
    get<{ companyName: string; setupCompleted: boolean }>('/v1/profile', true),
    get<{ documentCount: number; byStatus: Record<string, number> }[]>('/v1/knowledge', true),
  ]);
  const setupDone = !('error' in profile) && profile.setupCompleted;
  const ready = Array.isArray(kbs) ? kbs.reduce((a, k) => a + (k.byStatus.ready ?? 0), 0) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        Admin{!('error' in profile) && profile.companyName ? ` · ${profile.companyName}` : ''}
      </h1>

      {!setupDone && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950">
          <div>
            <p className="font-medium">Finish product setup</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Add your business details and knowledge so agents can answer real questions.</p>
          </div>
          <Link href="/admin/setup" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900">
            Start setup
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/knowledge" className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Knowledge sources ready</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{ready}</p>
        </Link>
        <Link href="/demo" className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Try it</p>
          <p className="mt-1 text-lg font-semibold">Open the voice demo →</p>
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">System health</h2>
        {'error' in health ? (
          <p className="text-red-600">API unreachable: {health.error}</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {Object.entries(health.services).map(([name, s]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono">{name}</span>
                <span className={s.ok ? 'text-emerald-600' : 'text-red-600'}>
                  {s.ok ? 'healthy' : `down: ${s.error ?? 'unknown'}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-zinc-500">Calls, leads, tickets and agent settings arrive in Phase 4.</p>
    </div>
  );
}
