// Admin session cookie helpers (server only). The cookie holds an opaque token issued by the
// API; the API stores only its hash and checks it on every request.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE = 'ab_session';
export const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export function isHttps(req: NextRequest) {
  return (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https';
}

/** Client IP for login throttling in the API. */
export function forwardedFor(req: NextRequest) {
  return req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string, expiresAt: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(req),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Same-origin check for state-changing auth routes (defence in depth on top of SameSite). */
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
