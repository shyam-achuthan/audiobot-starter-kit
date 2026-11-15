import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';
import { normalizePhone } from '../common/phone';
import { Call, CallTurn, Lead, Ticket } from '../database/models';
import { and, dateRange, paging, search } from '../common/list-query';
import { EventsService } from '../integrations/events.service';
import { callData } from '../integrations/payloads';
import { CreateCallDto, CreateTurnDto, ListCallsQuery, UpdateCallDto } from './calls.dto';

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

@Injectable()
export class CallsService {
  constructor(
    @InjectModel(Call) private readonly calls: typeof Call,
    @InjectModel(CallTurn) private readonly turns: typeof CallTurn,
    private readonly events: EventsService,
  ) {}

  async create(dto: CreateCallDto) {
    try {
      return await this.events.tx(async (t) => {
        const call = await this.calls.create({
          room: dto.room,
          channel: dto.channel ?? 'web',
          startWorkflow: dto.workflow,
          agentPath: [dto.workflow],
          language: dto.language ?? null,
        }, { transaction: t });
        await this.events.emit('call.started', `call:${call.id}`, callData(call), t);
        return call;
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) {
        // Agent restarted inside the same room: reuse the existing call.
        return this.calls.findOne({ where: { room: dto.room } });
      }
      throw e;
    }
  }

  async get(id: string) {
    const call = await this.calls.findByPk(id, {
      include: [
        { model: CallTurn, separate: true, order: [['turnNo', 'ASC']] },
        { model: Lead },
        { model: Ticket },
      ],
    });
    if (!call) throw new NotFoundException('call not found');
    return call;
  }

  async list(q: ListCallsQuery) {
    const where = and(
      q.status && { status: q.status },
      q.outcome && { outcome: q.outcome },
      q.channel && { channel: q.channel },
      // Calls that started in or passed through this workflow.
      q.workflow && { agentPath: { [Op.contains]: [q.workflow] } },
      search(q.q, ['callerName', 'callerPhone', 'callerEmail', 'room']),
      dateRange('startedAt', q),
    );
    const { rows, count } = await this.calls.findAndCountAll({
      where, order: [['startedAt', q.order === 'asc' ? 'ASC' : 'DESC']], ...paging(q),
    });
    return { items: rows, total: count };
  }

  async update(id: string, dto: UpdateCallDto) {
    const call = await this.calls.findByPk(id);
    if (!call) throw new NotFoundException('call not found');

    const patch: Partial<Call> = {};
    if (dto.outcome) patch.outcome = dto.outcome;
    if (dto.language) patch.language = dto.language;
    if (dto.agentPath) patch.agentPath = dto.agentPath;
    if (dto.callerName) patch.callerName = dto.callerName;
    if (dto.callerEmail) patch.callerEmail = dto.callerEmail;
    if (dto.callerPhone) {
      const phone = normalizePhone(dto.callerPhone);
      if (!phone) throw new BadRequestException('callerPhone is not a valid phone number');
      patch.callerPhone = phone;
    }
    if (dto.status === 'ended' && call.status !== 'ended') {
      const rows = await this.turns.findAll({ where: { callId: id }, order: [['turnNo', 'ASC']] });
      patch.status = 'ended';
      patch.endedAt = new Date();
      patch.turnCount = rows.length;
      patch.medianE2eMs = median(rows.map((r) => r.e2eMs).filter((x): x is number => x != null));
      if (!call.outcome && !dto.outcome) patch.outcome = rows.length ? 'info_only' : 'abandoned';
      return this.events.tx(async (t) => {
        await call.update(patch, { transaction: t });
        await this.events.emit('call.ended', `call:${call.id}`, callData(call, rows), t);
        return call;
      });
    }
    return call.update(patch);
  }

  async addTurn(callId: string, dto: CreateTurnDto) {
    if (!(await this.calls.count({ where: { id: callId } }))) throw new NotFoundException('call not found');
    const [turn] = await this.turns.upsert({ callId, ...dto, interrupted: dto.interrupted ?? false });
    return turn;
  }
}
