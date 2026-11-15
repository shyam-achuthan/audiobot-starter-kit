import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { SIPTransport } from '@livekit/protocol';
import { SipClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { CallsService } from '../calls/calls.service';
import { normalizePhone } from '../common/phone';
import { config, WORKFLOWS } from '../config';
import { BusinessProfile, Call, DialStatus, DndNumber, PhoneNumber, Ticket } from '../database/models';
import { TicketsService } from '../tickets/tickets.service';

const INBOUND_TRUNK = 'audiobots-inbound';
const OUTBOUND_TRUNK = 'audiobots-outbound';
const DISPATCH_RULE = 'audiobots-inbound';
const TRANSPORTS: Record<string, SIPTransport> = {
  udp: SIPTransport.SIP_TRANSPORT_UDP, tcp: SIPTransport.SIP_TRANSPORT_TCP,
  tls: SIPTransport.SIP_TRANSPORT_TLS, auto: SIPTransport.SIP_TRANSPORT_AUTO,
};

export type BlockReason = 'not_configured' | 'outside_hours' | 'dnd' | 'in_progress' | 'no_phone';

export class DialBlocked extends ConflictException {
  constructor(readonly reason: BlockReason, message: string) {
    super({ statusCode: 409, reason, message });
  }
}

/** "HH:MM" now in the dashboard timezone (IST by default). */
function localHHMM(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.dashboardTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
}

/**
 * Phone calls through the LiveKit SIP bridge: keeps LiveKit's inbound trunk, dispatch rule and
 * outbound trunk in line with Admin -> Phone, places outbound calls (with calling-hours and
 * do-not-call checks) and dials due callback tickets automatically.
 */
@Injectable()
export class TelephonyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Telephony');
  private readonly sip = new SipClient(
    config.livekit.url.replace(/^ws/, 'http'), config.livekit.apiKey, config.livekit.apiSecret,
  );
  private timers: NodeJS.Timeout[] = [];
  private outboundTrunkId: string | null = null;
  private syncing: Promise<void> | null = null;
  private lastSyncError: string | null = null;

  constructor(
    @InjectModel(PhoneNumber) private readonly numbers: typeof PhoneNumber,
    @InjectModel(DndNumber) private readonly dnd: typeof DndNumber,
    @InjectModel(Call) private readonly callModel: typeof Call,
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(BusinessProfile) private readonly profiles: typeof BusinessProfile,
    private readonly calls: CallsService,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit() {
    if (process.env.TELEPHONY_WORKER === 'false') return;
    this.timers.push(setTimeout(() => void this.sync(), 3_000));
    this.timers.push(setInterval(() => void this.sync(), 5 * 60_000)); // self-heal if LiveKit was reset
    this.timers.push(setInterval(() => void this.dueCallbacks(), 60_000));
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  // ------------------------------------------------------------------ LiveKit trunk sync

  /** Make LiveKit's SIP trunks and dispatch rule match our numbers and outbound settings. */
  sync(): Promise<void> {
    this.syncing ??= this.doSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async doSync() {
    try {
      const enabled = (await this.numbers.findAll({ where: { enabled: true } })).map((n) => n.number).sort();
      const auth = config.sip.inboundUsername
        ? { authUsername: config.sip.inboundUsername, authPassword: config.sip.inboundPassword }
        : { allowedAddresses: config.sip.inboundAllowed };

      let inbound = (await this.sip.listSipInboundTrunk()).find((t) => t.name === INBOUND_TRUNK);
      if (!enabled.length) {
        if (inbound) await this.sip.deleteSipTrunk(inbound.sipTrunkId);
        inbound = undefined;
      } else if (!inbound) {
        inbound = await this.sip.createSipInboundTrunk(INBOUND_TRUNK, enabled, { ...auth, krispEnabled: true });
        this.log.log(`created inbound trunk for ${enabled.length} number(s)`);
      } else {
        const same = [...inbound.numbers].sort().join(',') === enabled.join(',')
          && inbound.authUsername === (config.sip.inboundUsername || '')
          && [...inbound.allowedAddresses].sort().join(',') === (config.sip.inboundUsername ? '' : [...config.sip.inboundAllowed].sort().join(','));
        if (!same) {
          inbound.numbers = enabled;
          inbound.authUsername = config.sip.inboundUsername || '';
          inbound.authPassword = config.sip.inboundPassword || '';
          inbound.allowedAddresses = config.sip.inboundUsername ? [] : config.sip.inboundAllowed;
          inbound = await this.sip.updateSipInboundTrunk(inbound.sipTrunkId, inbound);
          this.log.log(`updated inbound trunk: ${enabled.length} number(s)`);
        }
      }

      const rule = (await this.sip.listSipDispatchRule()).find((r) => r.name === DISPATCH_RULE);
      if (!inbound) {
        if (rule) await this.sip.deleteSipDispatchRule(rule.sipDispatchRuleId);
      } else if (!rule) {
        // One room per caller ("sip-..."); the agent joins automatically and looks up the dialled number.
        await this.sip.createSipDispatchRule({ type: 'individual', roomPrefix: 'sip-' }, { name: DISPATCH_RULE, trunkIds: [inbound.sipTrunkId] });
      } else if (rule.trunkIds.join(',') !== inbound.sipTrunkId) {
        await this.sip.updateSipDispatchRuleFields(rule.sipDispatchRuleId, { trunkIds: [inbound.sipTrunkId] } as never);
      }

      const s = config.sip;
      let outbound = (await this.sip.listSipOutboundTrunk()).find((t) => t.name === OUTBOUND_TRUNK);
      if (!s.outboundAddress) {
        if (outbound) await this.sip.deleteSipTrunk(outbound.sipTrunkId);
        outbound = undefined;
      } else {
        const transport = TRANSPORTS[s.outboundTransport] ?? SIPTransport.SIP_TRANSPORT_UDP;
        const numbers = s.outboundNumber ? [s.outboundNumber] : [];
        if (!outbound) {
          outbound = await this.sip.createSipOutboundTrunk(OUTBOUND_TRUNK, s.outboundAddress, numbers, {
            transport, authUsername: s.outboundUsername || undefined, authPassword: s.outboundPassword || undefined,
          });
          this.log.log(`created outbound trunk to ${s.outboundAddress}`);
        } else if (outbound.address !== s.outboundAddress || outbound.numbers.join(',') !== numbers.join(',')
          || outbound.transport !== transport || outbound.authUsername !== (s.outboundUsername || '')) {
          outbound.address = s.outboundAddress;
          outbound.numbers = numbers;
          outbound.transport = transport;
          outbound.authUsername = s.outboundUsername || '';
          outbound.authPassword = s.outboundPassword || '';
          outbound = await this.sip.updateSipOutboundTrunk(outbound.sipTrunkId, outbound);
          this.log.log(`updated outbound trunk to ${s.outboundAddress}`);
        }
      }
      this.outboundTrunkId = outbound?.sipTrunkId ?? null;
      this.lastSyncError = null;
    } catch (e) {
      this.lastSyncError = (e as Error).message;
      this.log.warn(`SIP sync failed: ${this.lastSyncError}`);
    }
  }

  async status() {
    let bridge = false;
    try {
      const r = await fetch(config.sip.healthUrl, { signal: AbortSignal.timeout(1500) });
      bridge = r.ok;
    } catch { /* not running */ }
    const profile = await this.profile();
    return {
      bridgeRunning: bridge,
      sipUri: config.sip.publicHost ? `sip:${config.sip.publicHost}:5060` : null,
      syncError: this.lastSyncError,
      inbound: {
        numbers: await this.numbers.count({ where: { enabled: true } }),
        auth: config.sip.inboundUsername ? 'username/password' : `allowed networks: ${config.sip.inboundAllowed.join(', ')}`,
      },
      outbound: {
        configured: Boolean(config.sip.outboundAddress),
        address: config.sip.outboundAddress || null,
        callerId: config.sip.outboundNumber || null,
      },
      rules: {
        outboundHoursStart: profile.outboundHoursStart,
        outboundHoursEnd: profile.outboundHoursEnd,
        autoCallbacks: profile.autoCallbacks,
        timezone: config.dashboardTimezone,
        maxCallbackAttempts: config.sip.maxCallbackAttempts,
        callbackRetryMinutes: config.sip.callbackRetryMinutes,
      },
    };
  }

  private async profile() {
    const [p] = await this.profiles.findOrCreate({ where: { id: 1 }, defaults: { id: 1, companyName: 'AudioBots Demo' } });
    return p;
  }

  /** Agent: which agent answers calls to this number. */
  async lookup(number: string) {
    const n = normalizePhone(number) ?? number;
    const row = await this.numbers.findOne({ where: { number: n, enabled: true } });
    return { number: n, workflow: row?.workflow ?? 'router', label: row?.label ?? null, known: Boolean(row) };
  }

  // ------------------------------------------------------------------ outbound

  private withinHours(start: string, end: string, now = localHHMM()) {
    return start <= end ? now >= start && now < end : now >= start || now < end; // overnight windows
  }

  /** Why a call to `phone` can't be placed right now, or null if it can. */
  async blocked(phone: string | null): Promise<{ reason: BlockReason; message: string } | null> {
    if (!config.sip.outboundAddress || !this.outboundTrunkId) {
      return { reason: 'not_configured', message: 'Outbound calling is not set up (SIP_OUTBOUND_ADDRESS)' };
    }
    if (!phone) return { reason: 'no_phone', message: 'No valid phone number to call' };
    const p = await this.profile();
    if (!this.withinHours(p.outboundHoursStart, p.outboundHoursEnd)) {
      return { reason: 'outside_hours', message: `Outbound calls are allowed ${p.outboundHoursStart}–${p.outboundHoursEnd} (${config.dashboardTimezone})` };
    }
    if (await this.dnd.findByPk(phone)) return { reason: 'dnd', message: `${phone} is on the do-not-call list` };
    const live = await this.callModel.count({
      where: { remoteNumber: phone, status: 'active', direction: 'outbound', startedAt: { [Op.gt]: new Date(Date.now() - 30 * 60_000) } },
    });
    if (live) return { reason: 'in_progress', message: 'A call to this number is already in progress' };
    return null;
  }

  /** Dashboard pre-check for a phone number or a ticket's contact number. */
  async checkFor(phone?: string, ticketRef?: string) {
    const ticket = ticketRef ? await this.tickets.find(ticketRef) : null;
    return this.blocked(normalizePhone(phone ?? ticket?.contactPhone ?? null));
  }

  /**
   * Place an outbound call. The agent joins the new room automatically, waits for the callee to
   * answer and opens with `context`. Returns once dialling has started.
   */
  async dial(input: { phone?: string; ticketRef?: string; workflow?: string; context?: string }, actor: string) {
    if (!this.outboundTrunkId && config.sip.outboundAddress) await this.sync();
    const ticket = input.ticketRef ? await this.tickets.find(input.ticketRef) : null;
    const phone = normalizePhone(input.phone ?? ticket?.contactPhone ?? null);
    if (input.phone && !phone) throw new BadRequestException('phone is not a valid number');
    const block = await this.blocked(phone);
    if (block) throw new DialBlocked(block.reason, block.message);

    const original = ticket?.callId ? await this.callModel.findByPk(ticket.callId) : null;
    const workflow = input.workflow
      ?? original?.agentPath?.at(-1)
      ?? (ticket ? (ticket.leadId ? 'sales' : 'support') : 'router');
    if (!WORKFLOWS.includes(workflow as never)) throw new BadRequestException(`unknown workflow ${workflow}`);
    const context = input.context ?? (ticket
      ? [`Calling back about ${ticket.ref}: ${ticket.subject}.`, ticket.description, ticket.preferredCallbackTime && `They asked to be called: ${ticket.preferredCallbackTime}.`]
        .filter(Boolean).join(' ')
      : null);

    const room = `out-${randomUUID()}`;
    const call = (await this.calls.create({
      room, channel: 'sip', workflow, direction: 'outbound', remoteNumber: phone!, localNumber: config.sip.outboundNumber || undefined,
    }))!;
    await call.update({
      dialStatus: 'dialing', ticketId: ticket?.id ?? null, callerName: ticket?.contactName ?? null, callerPhone: phone,
      metadata: { ...call.metadata, outbound: { by: actor, context, ticketRef: ticket?.ref ?? null } },
    });
    if (ticket) {
      await ticket.update({ callbackAttempts: ticket.callbackAttempts + 1, lastCallbackAt: new Date() }, { hooks: false });
    }

    const metadata = JSON.stringify({
      direction: 'outbound', workflow, callId: call.id, ticketRef: ticket?.ref ?? null, context, channel: 'sip',
    });
    // Ring in the background; the HTTP request returns while it rings.
    void this.sip.createSipParticipant(this.outboundTrunkId!, phone!, room, {
      participantIdentity: `phone-${call.id.slice(0, 8)}`,
      participantName: ticket?.contactName ?? phone!,
      participantMetadata: metadata,
      waitUntilAnswered: true,
      ringingTimeout: 30,
      maxCallDuration: 30 * 60,
      krispEnabled: true,
    }).then(
      () => this.answered(call, ticket),
      (e) => this.dialFailed(call, e as Error),
    );
    this.log.log(`dialling ${phone} (${workflow}) for ${actor}${ticket ? ` · ${ticket.ref}` : ''}`);
    return { callId: call.id, room, phone, workflow, dialStatus: 'dialing' as DialStatus };
  }

  private async answered(call: Call, ticket: Ticket | null) {
    await call.update({ dialStatus: 'answered' });
    // A callback that connected is being handled: stop the scheduler from calling again.
    if (ticket?.type === 'callback' && ticket.status === 'open') {
      await this.tickets.update(ticket.ref, { status: 'in_progress' }, { source: 'callback' }).catch((e) =>
        this.log.warn(`could not update ${ticket.ref} after callback: ${(e as Error).message}`));
    }
  }

  private async dialFailed(call: Call, e: Error) {
    const msg = e.message ?? String(e);
    const status: DialStatus = /486|busy/i.test(msg) ? 'busy'
      : /480|408|487|no answer|timeout|timed out|unavailable/i.test(msg) ? 'no_answer' : 'failed';
    this.log.warn(`call ${call.id} to ${call.remoteNumber} not connected: ${status} (${msg})`);
    await call.update({ dialStatus: status, dialError: msg.slice(0, 500) });
    if (call.status !== 'ended') await this.calls.update(call.id, { status: 'ended', outcome: 'abandoned' }).catch(() => undefined);
  }

  /** Scheduled callbacks: dial open callback tickets whose time has come (within the rules). */
  async dueCallbacks() {
    try {
      const p = await this.profile();
      if (!p.autoCallbacks || !this.outboundTrunkId) return;
      if (!this.withinHours(p.outboundHoursStart, p.outboundHoursEnd)) return;
      const retryBefore = new Date(Date.now() - config.sip.callbackRetryMinutes * 60_000);
      const due = await this.ticketModel.findAll({
        where: {
          type: 'callback', status: 'open', contactPhone: { [Op.ne]: null },
          callbackAt: { [Op.lte]: new Date() },
          callbackAttempts: { [Op.lt]: config.sip.maxCallbackAttempts },
          [Op.or]: [{ lastCallbackAt: null }, { lastCallbackAt: { [Op.lt]: retryBefore } }],
        },
        order: [['callbackAt', 'ASC']],
        limit: 3, // a few at a time; the rest go on the next tick
      });
      for (const t of due) {
        try {
          await this.dial({ ticketRef: t.ref }, 'scheduler');
        } catch (e) {
          if (e instanceof DialBlocked && e.reason === 'dnd') {
            await t.update({ callbackAttempts: config.sip.maxCallbackAttempts }, { hooks: false }); // never retry
          }
          this.log.warn(`scheduled callback ${t.ref} skipped: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.warn(`callback scheduler failed: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ numbers + DND (Admin -> Phone)

  listNumbers() {
    return this.numbers.findAll({ order: [['createdAt', 'ASC']] });
  }

  async saveNumber(id: string | null, dto: { number?: string; label?: string | null; workflow?: string; enabled?: boolean }) {
    const patch: Partial<PhoneNumber> = {};
    if (dto.number !== undefined) {
      const n = normalizePhone(dto.number) ?? (/^\+\d{8,15}$/.test(dto.number.trim()) ? dto.number.trim() : null);
      if (!n) throw new BadRequestException('Enter the number in international format, e.g. +918045671234');
      patch.number = n;
    }
    if (dto.label !== undefined) patch.label = dto.label?.trim() || null;
    if (dto.workflow !== undefined) patch.workflow = dto.workflow;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    let row: PhoneNumber;
    try {
      if (id) {
        const found = await this.numbers.findByPk(id);
        if (!found) throw new NotFoundException('number not found');
        row = await found.update(patch);
      } else {
        if (!patch.number) throw new BadRequestException('number is required');
        row = await this.numbers.create(patch);
      }
    } catch (e) {
      if ((e as Error).name === 'SequelizeUniqueConstraintError') throw new ConflictException('That number is already added');
      throw e;
    }
    await this.sync();
    return row;
  }

  async deleteNumber(id: string) {
    const n = await this.numbers.destroy({ where: { id } });
    if (!n) throw new NotFoundException('number not found');
    await this.sync();
    return { deleted: true };
  }

  async listDnd(q?: string) {
    const where = q ? { number: { [Op.like]: `%${q.replace(/[^\d+]/g, '')}%` } } : {};
    const [items, total] = await Promise.all([
      this.dnd.findAll({ where, order: [['createdAt', 'DESC']], limit: 200 }),
      this.dnd.count({ where }),
    ]);
    return { items, total };
  }

  /** Add numbers from pasted text or CSV (anything that looks like a phone number). */
  async addDnd(text: string, note: string | null, actor: string) {
    const found = new Set<string>();
    const invalid: string[] = [];
    for (const raw of text.split(/[\n,;\t]+/)) {
      const v = raw.trim();
      if (!v) continue;
      const n = normalizePhone(v);
      if (n) found.add(n); else invalid.push(v.slice(0, 40));
    }
    const rows = [...found].map((number) => ({ number, note, addedBy: actor }));
    if (rows.length) await this.dnd.bulkCreate(rows, { ignoreDuplicates: true });
    return { added: rows.length, invalid: invalid.slice(0, 20), invalidCount: invalid.length };
  }

  async removeDnd(number: string) {
    const n = normalizePhone(number) ?? number;
    await this.dnd.destroy({ where: { number: n } });
    return { removed: true };
  }

  async updateRules(dto: { outboundHoursStart?: string; outboundHoursEnd?: string; autoCallbacks?: boolean }) {
    const p = await this.profile();
    await p.update(dto);
    return (await this.status()).rules;
  }
}
