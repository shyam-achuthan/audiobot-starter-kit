import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../config';
import type { AdminUser } from '../database/models';
import { AuthService } from './auth.service';

export type Principal =
  | { kind: 'agent' }
  | { kind: 'user'; user: AdminUser; sessionId: string };

export type AuthedRequest = Request & { principal?: Principal };

const ACCESS = 'audiobots:access';
type Access = 'agent' | 'owner';

/** Only the voice agent (AGENT_API_TOKEN) may call this route. */
export const AgentOnly = () => SetMetadata(ACCESS, 'agent' satisfies Access);
/** Only admin users with the owner role (user management). */
export const OwnerOnly = () => SetMetadata(ACCESS, 'owner' satisfies Access);

/**
 * Accepts either `Authorization: Bearer <AGENT_API_TOKEN>` (voice agent, server-side jobs)
 * or `Authorization: Bearer <session token>` (a signed-in admin; the web app forwards the cookie).
 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  private readonly agentToken = Buffer.from(config.agentApiToken);

  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS, [ctx.getHandler(), ctx.getClass()]);
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('sign in required');

    const got = Buffer.from(token);
    if (got.length === this.agentToken.length && timingSafeEqual(got, this.agentToken)) {
      req.principal = { kind: 'agent' };
      if (access === 'owner') throw new ForbiddenException('owner account required');
      return true;
    }
    if (access === 'agent') throw new ForbiddenException('agent token required');

    const session = await this.auth.resolveSession(token);
    if (!session) throw new UnauthorizedException('session expired; sign in again');
    if (access === 'owner' && session.user.role !== 'owner') throw new ForbiddenException('owner account required');
    req.principal = { kind: 'user', user: session.user, sessionId: session.id };
    return true;
  }
}

export function actorOf(req: AuthedRequest): string {
  return req.principal?.kind === 'user' ? req.principal.user.email : 'agent';
}
