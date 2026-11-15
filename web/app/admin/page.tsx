import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import { Overview } from './_overview';

export const dynamic = 'force-dynamic';

type Health = { ok: boolean; services: Record<string, { ok: boolean; error?: string }> };

export default async function AdminPage() {
  const [health, profile] = await Promise.all([
    serverApi<Health>('/health'),
    serverApi<{ companyName: string; setupCompleted: boolean }>('/v1/profile'),
  ]);
  const setupDone = !('error' in profile) && profile.setupCompleted;
  const down = 'error' in health ? [] : Object.entries(health.services).filter(([, s]) => !s.ok);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        Overview{!('error' in profile) && profile.companyName ? ` · ${profile.companyName}` : ''}
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

      {'error' in health ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          API unreachable: {health.error}
        </p>
      ) : down.length > 0 && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Service down: {down.map(([n, s]) => `${n} (${s.error ?? 'unknown'})`).join(', ')}
        </p>
      )}

      <Overview />

      {!('error' in health) && (
        <p className="text-xs text-zinc-500">
          System: {Object.entries(health.services).map(([n, s]) => `${n} ${s.ok ? 'healthy' : 'down'}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
