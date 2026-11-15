import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  Connector, EventType, OutboxEvent, WebhookDelivery, WebhookEndpoint,
} from '../database/models';
import { ConnectorRegistry } from './connector-registry';
import { DeliveryWorker } from './delivery.worker';

/** Outbox: business events are written in the caller's transaction, then delivered by DeliveryWorker. */
@Injectable()
export class EventsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(OutboxEvent) private readonly events: typeof OutboxEvent,
    @InjectModel(WebhookDelivery) private readonly deliveries: typeof WebhookDelivery,
    @InjectModel(WebhookEndpoint) private readonly endpoints: typeof WebhookEndpoint,
    private readonly connectors: ConnectorRegistry,
    private readonly worker: DeliveryWorker,
  ) {}

  /** Run `fn` in a transaction; events emitted with it are committed atomically with the change. */
  tx<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(fn);
  }

  /**
   * Record an event and fan it out to every enabled endpoint that subscribes to it and every
   * configured connector that handles it.
   */
  async emit(type: EventType, subject: string, data: unknown, t: Transaction): Promise<void> {
    const payload = { type, timestamp: new Date().toISOString(), data: JSON.parse(JSON.stringify(data)) };
    const event = await this.events.create({ type, subject, payload }, { transaction: t });

    const endpoints = await this.endpoints.findAll({ where: { enabled: true }, transaction: t });
    const rows: Partial<WebhookDelivery>[] = endpoints
      .filter((e) => !e.events.length || e.events.includes(type))
      .map((e) => ({ eventId: event.id, endpointId: e.id }));

    for (const c of this.connectors.all()) {
      if (!c.configured() || !c.handles(type)) continue;
      // Connectors sync the subject's current state, so one pending sync per subject is enough.
      const pending = await this.deliveries.count({
        where: { connector: c.name, status: 'pending' },
        include: [{ model: OutboxEvent, where: { subject }, attributes: [] }],
        transaction: t,
      });
      if (!pending) rows.push({ eventId: event.id, connector: c.name });
    }
    if (rows.length) await this.deliveries.bulkCreate(rows, { transaction: t });
    t.afterCommit(() => this.worker.kick());
  }

  /** Queue a sync for one connector only (backfill); webhooks don't receive it. */
  async queueForConnector(connector: Connector, type: EventType, subject: string, data: unknown) {
    await this.tx(async (t) => {
      const event = await this.events.create({
        type, subject, payload: { type, timestamp: new Date().toISOString(), data: JSON.parse(JSON.stringify(data)) },
      }, { transaction: t });
      await this.deliveries.create({ eventId: event.id, connector }, { transaction: t });
    });
    this.worker.kick();
  }

  /** Queue a test event for one endpoint (not stored against any record). */
  async test(endpoint: WebhookEndpoint) {
    const delivery = await this.tx(async (t) => {
      const event = await this.events.create({
        type: 'webhook.test', subject: `endpoint:${endpoint.id}`,
        payload: { type: 'webhook.test', timestamp: new Date().toISOString(), data: { message: 'Test event from AudioBots', endpoint: endpoint.name } },
      }, { transaction: t });
      return this.deliveries.create({ eventId: event.id, endpointId: endpoint.id }, { transaction: t });
    });
    this.worker.kick();
    return delivery;
  }
}
