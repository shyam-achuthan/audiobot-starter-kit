import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { OutboxEvent, WebhookDelivery, WebhookEndpoint } from '../database/models';
import { ConnectorRegistry } from './connector-registry';
import { ConnectorError } from './connectors/connector';
import { signedHeaders } from './signing';

/** Delay before attempt n+1 after attempt n failed (Standard Webhooks' suggested schedule, ~27 h total). */
export const RETRY_DELAYS_S = [5, 5 * 60, 30 * 60, 2 * 3600, 5 * 3600, 10 * 3600, 10 * 3600];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;
const BATCH = 20;
const LEASE_S = 60;
const IDLE_POLL_MS = 3000;
const TIMEOUT_MS = 10_000;

type Outcome = { ok: boolean; status?: number; error?: string; response?: string; ms: number };

@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Deliveries');
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private stopped = false;
  private lastPrune = 0;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(WebhookDelivery) private readonly deliveries: typeof WebhookDelivery,
    @InjectModel(WebhookEndpoint) private readonly endpoints: typeof WebhookEndpoint,
    @InjectModel(OutboxEvent) private readonly events: typeof OutboxEvent,
    private readonly connectors: ConnectorRegistry,
  ) {}

  onApplicationBootstrap() {
    if (process.env.DELIVERY_WORKER === 'false') return;
    this.schedule(1000);
  }

  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Deliver as soon as possible (called after a commit that queued deliveries). */
  kick() {
    if (this.stopped) return;
    if (this.running) this.again = true;
    else this.schedule(0);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    let claimed = 0;
    try {
      const batch = await this.claim();
      claimed = batch.length;
      await Promise.allSettled(batch.map((d) => this.process(d)));
      if (Date.now() - this.lastPrune > 6 * 3600_000) {
        this.lastPrune = Date.now();
        await this.prune();
      }
    } catch (e) {
      this.log.error(`delivery loop: ${(e as Error).message}`);
    } finally {
      this.running = false;
      const busy = claimed === BATCH || this.again;
      this.again = false;
      if (!this.stopped) this.schedule(busy ? 0 : IDLE_POLL_MS);
    }
  }

  /**
   * Claim due deliveries with a lease (safe with several API instances). A connector delivery waits
   * while an older one for the same record is still queued or in flight, so syncs stay in order.
   */
  private async claim(): Promise<WebhookDelivery[]> {
    const rows = await this.sequelize.query<{ id: string }>(`
      UPDATE webhook_deliveries d
         SET status = 'sending', attempts = d.attempts + 1,
             locked_until = now() + interval '${LEASE_S} seconds', updated_at = now()
       WHERE d.id IN (
         SELECT x.id FROM webhook_deliveries x JOIN events ex ON ex.id = x.event_id
          WHERE ((x.status = 'pending' AND x.next_attempt_at <= now())
              OR (x.status = 'sending' AND x.locked_until < now()))
            AND (x.connector IS NULL OR NOT EXISTS (
                  SELECT 1 FROM webhook_deliveries y JOIN events ey ON ey.id = y.event_id
                   WHERE y.connector = x.connector AND ey.subject = ex.subject AND y.id < x.id
                     AND y.status IN ('pending', 'sending')))
          ORDER BY x.next_attempt_at
          LIMIT ${BATCH}
          FOR UPDATE OF x SKIP LOCKED)
      RETURNING d.id`, { type: QueryTypes.SELECT });
    if (!rows.length) return [];
    return this.deliveries.findAll({
      where: { id: rows.map((r) => r.id) },
      include: [{ model: OutboxEvent }, { model: WebhookEndpoint }],
    });
  }

  private async process(d: WebhookDelivery) {
    const out = await this.attempt(d);
    if (out.ok) {
      await d.update({
        status: 'succeeded', deliveredAt: new Date(), lockedUntil: null,
        lastStatusCode: out.status ?? null, lastError: null, lastResponse: out.response ?? null, lastDurationMs: out.ms,
      });
      return;
    }
    const dead = d.attempts >= MAX_ATTEMPTS || out.status === -1;
    await d.update({
      status: dead ? 'dead' : 'pending',
      nextAttemptAt: new Date(Date.now() + (RETRY_DELAYS_S[d.attempts - 1] ?? 0) * 1000),
      lockedUntil: null,
      lastStatusCode: out.status && out.status > 0 ? out.status : null,
      lastError: out.error ?? null, lastResponse: out.response ?? null, lastDurationMs: out.ms,
    });
    const target = d.connector ?? d.endpoint?.name ?? d.endpointId;
    this.log.warn(`${d.event?.type} -> ${target} attempt ${d.attempts} failed${dead ? ' (giving up)' : ''}: ${out.error}`);
  }

  private async attempt(d: WebhookDelivery): Promise<Outcome> {
    const started = Date.now();
    const ms = () => Date.now() - started;
    const event = d.event!;

    if (d.connector) {
      const c = this.connectors.get(d.connector);
      if (!c?.configured()) return { ok: false, status: -1, error: `${d.connector} is not configured`, ms: 0 };
      try {
        return { ok: true, response: await c.sync(event), ms: ms() };
      } catch (e) {
        const err = e as ConnectorError;
        return { ok: false, status: err.status, error: err.message, response: err.response, ms: ms() };
      }
    }

    const ep = d.endpoint;
    if (!ep) return { ok: false, status: -1, error: 'endpoint was deleted', ms: 0 };
    if (!ep.enabled && event.type !== 'webhook.test') return { ok: false, status: -1, error: 'endpoint is disabled', ms: 0 };
    const body = JSON.stringify(event.payload);
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'AudioBots-Webhooks/1.0',
          ...signedHeaders(ep.secret, `msg_${event.id}`, body),
        },
        body,
        redirect: 'manual', // a redirect counts as a failure, as Standard Webhooks recommends
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, response: text, ms: ms() };
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, response: text, ms: ms() };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      const why = err.name === 'TimeoutError' ? `no response within ${TIMEOUT_MS / 1000}s` : err.cause?.code ?? err.message;
      return { ok: false, error: why, ms: ms() };
    }
  }

  /** Housekeeping: drop events (and their deliveries) older than `days`. */
  private async prune(days = Number(process.env.EVENT_RETENTION_DAYS ?? 30)) {
    const n = await this.events.destroy({ where: { createdAt: { [Op.lt]: new Date(Date.now() - days * 864e5) } } });
    if (n) this.log.log(`pruned ${n} events older than ${days} days`);
  }

  /** Re-queue a dead or failed delivery now. */
  async retry(id: string) {
    const d = await this.deliveries.findByPk(id);
    if (!d) return null;
    await d.update({ status: 'pending', nextAttemptAt: new Date(), lockedUntil: null, attempts: 0 });
    this.kick();
    return d;
  }
}
