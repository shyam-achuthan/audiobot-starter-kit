import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { config } from '../config';
import { DbService } from '../db/db.service';
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
    private readonly db: DbService,
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
      this.db.ping(),
      this.livekit.ping(),
      pingHttp(`${config.litellm.url}/health/liveliness`),
    ]);
    const ok = db.ok && livekit.ok && litellm.ok;
    res.status(ok ? 200 : 503);
    return { ok, services: { db, livekit, litellm } };
  }
}
