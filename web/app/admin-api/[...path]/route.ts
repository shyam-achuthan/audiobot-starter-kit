// Server-side proxy for admin pages: forwards to the NestJS API with the signed-in admin's
// session token (from the httpOnly cookie). middleware.ts has already checked the session;
// the API checks it again and enforces roles.
import type { NextRequest } from 'next/server';
import { API, SESSION_COOKIE, forwardedFor } from '@/lib/session';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const headers: Record<string, string> = {
    authorization: `Bearer ${req.cookies.get(SESSION_COOKIE)?.value ?? ''}`,
    'x-forwarded-for': forwardedFor(req),
  };
  const type = req.headers.get('content-type');
  if (type) headers['content-type'] = type; // keeps the multipart boundary for uploads
  const range = req.headers.get('range');
  if (range) headers.range = range; // lets the recording player seek

  const res = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // Required by Node's fetch when streaming a request body (file uploads).
    ...(hasBody ? { duplex: 'half' } : {}),
    cache: 'no-store',
  } as RequestInit);
  const out = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/json' });
  // fetch() decompresses bodies, so a length is only valid for uncompressed responses.
  const lengthOk = !res.headers.get('content-encoding');
  for (const h of ['content-length', 'content-range', 'accept-ranges', 'cache-control']) {
    const v = res.headers.get(h);
    if (v && (h !== 'content-length' || lengthOk)) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
