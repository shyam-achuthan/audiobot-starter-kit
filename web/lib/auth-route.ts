// Shared handler for /auth/login and /auth/setup: forwards credentials to the API and stores
// the returned session token in an httpOnly cookie (never exposed to page JavaScript).
import { NextResponse, type NextRequest } from 'next/server';
import { API, forwardedFor, sameOrigin, setSessionCookie } from './session';

export async function exchange(req: NextRequest, apiPath: string) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'cross-origin request refused' }, { status: 403 });
  let body: string;
  try {
    body = JSON.stringify(await req.json());
  } catch {
    return NextResponse.json({ message: 'invalid request' }, { status: 400 });
  }
  const r = await fetch(`${API}${apiPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': forwardedFor(req),
      'user-agent': req.headers.get('user-agent') ?? '',
    },
    body,
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ message: data.message ?? 'sign-in failed' }, { status: r.status });
  const res = NextResponse.json({ user: data.user });
  setSessionCookie(res, req, data.token, data.expiresAt);
  return res;
}
