// Admin area gate: requires a valid session cookie (email + password sign-in on /login).
// The API is the authority; results are cached briefly so page loads don't each round-trip.
import { NextResponse, type NextRequest } from 'next/server';
import { API, SESSION_COOKIE, clearSessionCookie } from './lib/session';

const cache = new Map<string, number>(); // token -> valid until (ms)
const TTL_MS = 30_000;

async function valid(token: string): Promise<boolean> {
  const until = cache.get(token);
  if (until && until > Date.now()) return true;
  try {
    const r = await fetch(`${API}/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) {
      cache.delete(token);
      return false;
    }
  } catch {
    return false;
  }
  if (cache.size > 1000) cache.clear();
  cache.set(token, Date.now() + TTL_MS);
  return true;
}

export async function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/admin-api');
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await valid(token))) return NextResponse.next();

  if (isApi) {
    const res = NextResponse.json({ message: 'sign in required' }, { status: 401 });
    if (token) clearSessionCookie(res);
    return res;
  }
  const login = new URL('/login', req.url);
  login.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  const res = NextResponse.redirect(login);
  if (token) clearSessionCookie(res);
  return res;
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/admin-api/:path*'],
  runtime: 'nodejs', // read API_INTERNAL_URL at runtime
};
