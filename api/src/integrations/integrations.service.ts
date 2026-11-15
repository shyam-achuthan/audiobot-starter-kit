import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, WhereOptions, literal } from 'sequelize';
import { EVENT_TYPES, Lead, OutboxEvent, Ticket, WebhookDelivery, WebhookEndpoint } from '../database/models';
import { ConnectorRegistry } from './connector-registry';
import { DeliveryWorker, MAX_ATTEMPTS, RETRY_DELAYS_S } from './delivery.worker';
import { EventsService } from './events.service';
import { CreateEndpointDto, ListDeliveriesQuery, UpdateEndpointDto } from './integrations.dto';
import { leadData, ticketData } from './payloads';
import { newWebhookSecret } from './signing';

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectModel(WebhookEndpoint) private readonly endpoints: typeof WebhookEndpoint,
    @InjectModel(WebhookDelivery) private readonly deliveries: typeof WebhookDelivery,
    @InjectModel(Lead) private readonly leads: typeof Lead,
    @InjectModel(Ticket) private readonly tickets: typeof Ticket,
    private readonly connectors: ConnectorRegistry,
    private readonly events: EventsService,
    private readonly worker: DeliveryWorker,
  ) {}

  /** Everything the Integrations page needs in one call. */
  async overview() {
    const [connectors, endpoints, stats] = await Promise.all([
      Promise.all(this.connectors.all().map((c) => c.status())),
      this.endpoints.findAll({ order: [['createdAt', 'ASC']] }),
      this.endpoints.sequelize!.query<{ target: string; status: string; n: string; last_at: Date }>(`
        SELECT coalesce(endpoint_id::text, connector) AS target, status, count(*) AS n, max(updated_at) AS last_at
          FROM webhook_deliveries WHERE created_at > now() - interval '7 days'
         GROUP BY 1, 2`, { type: QueryTypes.SELECT }),
    ]);
    const summary = (target: string) => {
      const rows = stats.filter((s) => s.target === target);
      const count = (st: string) => Number(rows.find((r) => r.status === st)?.n ?? 0);
      const last = rows.reduce<Date | null>((m, r) => (!m || r.last_at > m ? r.last_at : m), null);
      return { succeeded: count('succeeded'), pending: count('pending') + count('sending'), dead: count('dead'), lastActivityAt: last };
    };
    return {
      eventTypes: EVENT_TYPES,
      retry: { maxAttempts: MAX_ATTEMPTS, delaysSec: RETRY_DELAYS_S },
      connectors: connectors.map((c) => ({ ...c, last7d: summary(c.name) })),
      endpoints: endpoints.map((e) => ({ ...e.toJSON(), last7d: summary(e.id) })),
    };
  }

  private async endpoint(id: string) {
    const ep = await this.endpoints.findByPk(id);
    if (!ep) throw new NotFoundException('webhook endpoint not found');
    return ep;
  }

  async create(dto: CreateEndpointDto, actor: string) {
    const ep = await this.endpoints.create({
      name: dto.name.trim(), url: dto.url, events: dto.events ?? [], enabled: dto.enabled ?? true,
      secret: newWebhookSecret(), createdBy: actor,
    });
    return { ...ep.toJSON(), secret: ep.secret };
  }

  async update(id: string, dto: UpdateEndpointDto) {
    const ep = await this.endpoint(id);
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (typeof patch.name === 'string') patch.name = patch.name.trim();
    return ep.update(patch);
  }

  async remove(id: string) {
    await (await this.endpoint(id)).destroy();
    return { ok: true };
  }

  async secret(id: string) {
    return { secret: (await this.endpoint(id)).secret };
  }

  async rotateSecret(id: string) {
    const ep = await this.endpoint(id);
    await ep.update({ secret: newWebhookSecret() });
    return { secret: ep.secret };
  }

  async test(id: string) {
    return this.events.test(await this.endpoint(id));
  }

  async listDeliveries(q: ListDeliveriesQuery) {
    const where: WhereOptions[] = [];
    if (q.endpointId) where.push({ endpointId: q.endpointId });
    if (q.connector) where.push({ connector: q.connector });
    if (q.status === 'failing') where.push({ status: 'pending', attempts: { [Op.gt]: 0 } });
    else if (q.status) where.push({ status: q.status });
    const { rows, count } = await this.deliveries.findAndCountAll({
      where: { [Op.and]: where },
      include: [
        { model: OutboxEvent, attributes: ['id', 'type', 'subject', 'createdAt'], ...(q.type ? { where: { type: q.type } } : {}) },
        { model: WebhookEndpoint, attributes: ['id', 'name', 'url'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: q.limit ?? 50, offset: q.offset ?? 0,
    });
    return { items: rows, total: count };
  }

  async delivery(id: string) {
    const d = await this.deliveries.findByPk(id, {
      include: [{ model: OutboxEvent }, { model: WebhookEndpoint, attributes: ['id', 'name', 'url'] }],
    });
    if (!d) throw new NotFoundException('delivery not found');
    return d;
  }

  async retry(id: string) {
    const d = await this.worker.retry(id);
    if (!d) throw new NotFoundException('delivery not found');
    return d;
  }

  /**
   * Queue a connector sync for every record it hasn't synced yet (e.g. leads captured before
   * Twenty was connected). Only that connector receives these; webhooks are not re-sent.
   */
  async backfill(name: string) {
    const c = this.connectors.get(name);
    if (!c) throw new NotFoundException('unknown connector');
    if (!c.configured()) throw new BadRequestException(`${c.label} is not configured`);
    const unsynced = literal(`NOT (external ? '${c.name}')`); // c.name is one of CONNECTORS
    const records = name === 'twenty'
      ? (await this.leads.findAll({ where: unsynced, order: [['createdAt', 'ASC']], limit: 500 })).map((l) => ({ type: 'lead.updated' as const, subject: `lead:${l.id}`, data: leadData(l) }))
      : (await this.tickets.findAll({ where: unsynced, order: [['createdAt', 'ASC']], limit: 500 })).map((t) => ({ type: 'ticket.updated' as const, subject: `ticket:${t.id}`, data: ticketData(t) }));
    for (const r of records) await this.events.queueForConnector(c.name, r.type, r.subject, r.data);
    return { queued: records.length };
  }
}
