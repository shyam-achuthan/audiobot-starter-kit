import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { strongerOutcome } from '../common/outcome';
import { normalizePhone } from '../common/phone';
import { Call, Ticket } from '../database/models';
import { and, dateRange, paging, search } from '../common/list-query';
import { EventsService } from '../integrations/events.service';
import { ticketData } from '../integrations/payloads';
import { CreateTicketDto, ListTicketsQuery, UpdateTicketDto } from './tickets.dto';

/** Accepts "TKT-1042", "tkt 1042", "1042" or a UUID. */
export function parseTicketRef(ref: string): { number?: number; id?: string } {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(ref)) return { id: ref };
  const digits = ref.replace(/\D/g, '');
  return digits ? { number: Number(digits) } : {};
}

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket) private readonly tickets: typeof Ticket,
    @InjectModel(Call) private readonly calls: typeof Call,
    private readonly events: EventsService,
  ) {}

  async create(dto: CreateTicketDto) {
    let contactPhone: string | null = null;
    if (dto.contactPhone) {
      contactPhone = normalizePhone(dto.contactPhone);
      if (!contactPhone) {
        throw new BadRequestException(
          'contactPhone is not a valid number; ask the caller to repeat it digit by digit',
        );
      }
    }
    const type = dto.type ?? 'support';
    return this.events.tx(async (t) => {
      const ticket = await this.tickets.create({
        ...dto,
        type,
        contactPhone,
        priority: dto.priority ?? (type === 'callback' ? 'high' : 'normal'),
      }, { transaction: t });

      if (dto.callId) {
        const call = await this.calls.findByPk(dto.callId, { transaction: t });
        if (call) {
          await call.update({
            outcome: strongerOutcome(call.outcome, type === 'callback' ? 'callback_requested' : 'ticket_created'),
            callerName: call.callerName ?? dto.contactName ?? null,
            callerPhone: call.callerPhone ?? contactPhone,
          }, { transaction: t });
        }
      }
      await this.events.emit('ticket.created', `ticket:${ticket.id}`, ticketData(ticket), t);
      return ticket;
    });
  }

  async find(ref: string) {
    const where = parseTicketRef(ref);
    if (!where.id && !where.number) throw new BadRequestException('invalid ticket reference');
    const ticket = await this.tickets.findOne({ where });
    if (!ticket) throw new NotFoundException(`ticket ${ref} not found`);
    return ticket;
  }

  /** Voice lookup: by ticket number, or the caller's latest tickets by phone. */
  async lookup(q: { ref?: string; phone?: string }) {
    if (q.ref) return [await this.find(q.ref)];
    const phone = normalizePhone(q.phone);
    if (!phone) throw new BadRequestException('provide a ticket number or a valid phone number');
    return this.tickets.findAll({
      where: { contactPhone: phone },
      order: [['createdAt', 'DESC']],
      limit: 3,
    });
  }

  async list(q: ListTicketsQuery) {
    const digits = q.q?.replace(/\D/g, '');
    const where = and(
      q.status === 'active' ? { status: ['open', 'in_progress'] } : q.status && { status: q.status },
      q.type && { type: q.type },
      q.priority && { priority: q.priority },
      q.q && {
        [Op.or]: [
          search(q.q, ['subject', 'description', 'contactName', 'contactPhone', 'contactEmail'])!,
          ...(digits && digits.length <= 9 ? [{ number: Number(digits) }] : []),
        ],
      },
      dateRange('createdAt', q),
    );
    const { rows, count } = await this.tickets.findAndCountAll({
      where, order: [['createdAt', q.order === 'asc' ? 'ASC' : 'DESC']], ...paging(q),
    });
    return { items: rows, total: count };
  }

  async update(ref: string, dto: UpdateTicketDto, opts: { source?: string } = {}) {
    const { id } = await this.find(ref);
    return this.events.tx(async (t) => {
      const ticket = (await this.tickets.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE }))!;
      ticket.set(Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
      if (ticket.changed('callbackAt')) ticket.set('callbackAttempts', 0);
      const changed = (ticket.changed() || []) as string[];
      if (!changed.length) return ticket;
      await ticket.save({ transaction: t });
      await this.events.emit('ticket.updated', `ticket:${ticket.id}`, {
        ...ticketData(ticket), changed, ...(opts.source ? { source: opts.source } : {}),
      }, t);
      return ticket;
    });
  }
}
