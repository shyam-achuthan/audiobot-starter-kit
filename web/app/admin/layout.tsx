import { serverApi, type Me } from '@/lib/server-api';
import { AdminNav, SignOut } from './_nav';

// Per-request: the signed-in user decides what's shown.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await serverApi<Me>('/v1/auth/me');
  const user = 'error' in me ? null : me;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AdminNav owner={user?.role === 'owner'} />
        {user && (
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <a href="/admin/account" className="hover:text-zinc-900 dark:hover:text-white">{user.name || user.email}</a>
            <SignOut />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
