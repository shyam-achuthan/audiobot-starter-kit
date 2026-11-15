import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../config';

/**
 * Protects internal endpoints used by the voice agent and server-side admin pages.
 * Callers send `Authorization: Bearer <AGENT_API_TOKEN>`.
 * (Admin user auth arrives in Phase 4.)
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  private readonly expected = Buffer.from(config.agentApiToken);

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const got = Buffer.from(token);
    if (got.length !== this.expected.length || !timingSafeEqual(got, this.expected)) {
      throw new UnauthorizedException('invalid or missing agent token');
    }
    return true;
  }
}
