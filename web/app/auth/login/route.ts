import type { NextRequest } from 'next/server';
import { exchange } from '@/lib/auth-route';

export const POST = (req: NextRequest) => exchange(req, '/v1/auth/login');
