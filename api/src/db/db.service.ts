import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { config } from '../config';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  async ping(): Promise<{ ok: boolean; pgvector?: string; error?: string }> {
    try {
      const r = await this.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
      );
      return { ok: true, pgvector: r.rows[0]?.extversion };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
