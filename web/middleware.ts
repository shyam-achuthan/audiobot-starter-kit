// Optional basic-auth gate for the admin area until real admin login (Phase 4).
// Set ADMIN_PASSWORD (and optionally ADMIN_USER, default "admin") to enable it.
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next(); // open in local dev

  const user = process.env.ADMIN_USER || 'admin';
  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const [u, ...rest] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    if (u === user && rest.join(':') === password) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="AudioBots admin"' },
  });
}

export const config = {
  matcher: ['/admin/:path*', '/admin-api/:path*'],
  runtime: 'nodejs', // read ADMIN_PASSWORD at runtime, not build time
};
