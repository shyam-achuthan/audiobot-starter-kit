// Runtime proxy to the NestJS API so the browser never needs the API's internal
// address (resolved at request time from API_INTERNAL_URL, not baked at build).
import type { NextRequest } from 'next/server';
import { forwardedFor } from '@/lib/session';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Public endpoints only: everything else needs an admin session (/admin-api) or the agent token.
const PUBLIC = new Set(['v1/livekit/token', 'v1/auth/status', 'health', 'v1/widget/config', 'v1/widget/session']);
// Called by the embedded widget from other websites: answer CORS. The API decides per widget
// whether the origin is allowed (and says no with 403), so the proxy can echo it.
const CROSS_SITE = new Set(['v1/widget/config', 'v1/widget/session']);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  return origin
    ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-max-age': '600' }
    : {};
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const route = path.join('/');
  if (!PUBLIC.has(route)) {
    return Response.json({ message: 'not found' }, { status: 404 });
  }
  const cors = CROSS_SITE.has(route) ? corsHeaders(req) : {};
  const url = `${API}/${route}${req.nextUrl.search}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const headers: Record<string, string> = {
    'content-type': req.headers.get('content-type') ?? 'application/json',
    // The API checks the page's origin and rate-limits by visitor IP.
    'x-forwarded-for': forwardedFor(req),
    'user-agent': req.headers.get('user-agent') ?? '',
  };
  // Lets the API recognise same-origin requests (e.g. the demo page opened via a LAN address).
  const host = req.headers.get('host');
  if (host) headers['x-forwarded-host'] = host;
  // Browsers omit Origin on same-origin GETs (the widget preview); fill in this page's own origin.
  const origin = req.headers.get('origin') ?? (host ? `${req.nextUrl.protocol}//${host}` : null);
  if (origin) headers.origin = origin;
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: 'no-store',
  });
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', ...cors },
  });
}

/** CORS preflight for the widget endpoints. */
export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!CROSS_SITE.has(path.join('/'))) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
