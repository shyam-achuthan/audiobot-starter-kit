import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { config } from '../config';
import { LivekitService } from '../livekit/livekit.service';

async function pingHttp(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly livekit: LivekitService,
  ) {}

  /** Liveness: the process is up. Used by the Docker healthcheck. */
  @Get('live')
  @HttpCode(200)
  live() {
    return { ok: true };
  }

  /** Readiness: dependencies reachable. 503 if any is down. */
  @Get()
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, livekit, litellm] = await Promise.all([
      this.pingDb(),
      this.livekit.ping(),
      pingHttp(`${config.litellm.url}/health/liveliness`),
    ]);
    const ok = db.ok && livekit.ok && litellm.ok;
    res.status(ok ? 200 : 503);
    return { ok, services: { db, livekit, litellm } };
  }

  private async pingDb() {
    try {
      const [ext] = await this.sequelize.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
        { type: QueryTypes.SELECT },
      );
      const [mig] = await this.sequelize.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
        { type: QueryTypes.SELECT },
      );
      return { ok: true, pgvector: ext?.extversion, migration: mig?.name };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
