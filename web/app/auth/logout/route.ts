import { NextResponse, type NextRequest } from 'next/server';
import { API, SESSION_COOKIE, clearSessionCookie, sameOrigin } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'cross-origin request refused' }, { status: 403 });
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await fetch(`${API}/v1/auth/logout`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, cache: 'no-store',
    }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
