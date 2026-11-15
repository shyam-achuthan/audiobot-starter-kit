import type { NextRequest } from 'next/server';
import { exchange } from '@/lib/auth-route';

// Creates the first owner account (the API refuses once any account exists).
export const POST = (req: NextRequest) => exchange(req, '/v1/auth/setup');
