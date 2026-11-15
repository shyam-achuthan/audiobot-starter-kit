// Server-component fetch to the API as the signed-in admin.
import { cookies } from 'next/headers';
import { API, SESSION_COOKIE } from './session';

export async function serverApi<T>(path: string): Promise<T | { error: string; status?: number }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  try {
    const r = await fetch(`${API}${path}`, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    if (!r.ok) return { error: data?.message ?? `HTTP ${r.status}`, status: r.status };
    return data as T;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type Me = { id: string; email: string; name: string | null; role: 'owner' | 'admin' };
