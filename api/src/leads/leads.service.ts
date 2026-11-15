import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { strongerOutcome } from '../common/outcome';
import { normalizePhone } from '../common/phone';
import { Call, Lead } from '../database/models';
import { UpsertLeadDto } from './leads.dto';

/** Drops undefined/empty values so partial updates never blank out saved fields. */
function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead) private readonly leads: typeof Lead,
    @InjectModel(Call) private readonly calls: typeof Call,
  ) {}

  private normalize(dto: UpsertLeadDto): Partial<UpsertLeadDto> {
    const data = clean(dto);
    if (data.phone !== undefined) {
      const phone = normalizePhone(data.phone);
      if (!phone) {
        throw new BadRequestException(
          'phone is not a valid number; ask the caller to repeat it digit by digit',
        );
      }
      data.phone = phone;
    }
    return data;
  }

  async create(dto: UpsertLeadDto) {
    const lead = await this.leads.create(this.normalize(dto));
    await this.syncCall(lead);
    return lead;
  }

  async update(id: string, dto: UpsertLeadDto) {
    const lead = await this.leads.findByPk(id);
    if (!lead) throw new NotFoundException('lead not found');
    await lead.update(this.normalize(dto));
    await this.syncCall(lead);
    return lead;
  }

  async get(id: string) {
    const lead = await this.leads.findByPk(id);
    if (!lead) throw new NotFoundException('lead not found');
    return lead;
  }

  list(limit = 50) {
    return this.leads.findAll({ order: [['createdAt', 'DESC']], limit: Math.min(limit, 200) });
  }

  /** Mirror caller identity + outcome onto the call record. */
  private async syncCall(lead: Lead) {
    if (!lead.callId) return;
    const call = await this.calls.findByPk(lead.callId);
    if (!call) return;
    await call.update(clean({
      callerName: call.callerName ?? lead.name,
      callerPhone: call.callerPhone ?? lead.phone,
      callerEmail: call.callerEmail ?? lead.email,
      outcome: strongerOutcome(call.outcome, 'lead_captured'),
    }));
  }
}
