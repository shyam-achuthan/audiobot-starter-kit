import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal } from 'sequelize';
import { config } from '../../config';
import { Call, CallTurn, Lead, OutboxEvent, Ticket } from '../../database/models';
import { Connector, ConnectorError, ConnectorStatus, http, subjectId } from './connector';

/** Our ticket priority -> Chatwoot conversation priority. */
const PRIORITY: Record<string, string> = { low: 'low', normal: 'medium', high: 'high', urgent: 'urgent' };
/** Our ticket status -> Chatwoot conversation status. */
const TO_CHATWOOT: Record<string, string> = { open: 'open', in_progress: 'open', resolved: 'resolved', closed: 'resolved' };
/** Chatwoot status -> our status (pending/snoozed mean someone is working on it). */
const FROM_CHATWOOT: Record<string, string> = { open: 'open', pending: 'in_progress', snoozed: 'in_progress', resolved: 'resolved' };

type ChatwootIds = {
  contactId?: number;
  conversationId?: number;
  /** Last status/priority we pushed, so changes made in Chatwoot aren't overwritten on unrelated updates. */
  status?: string;
  priority?: string;
  syncedAt?: string;
};

/**
 * Mirrors tickets into Chatwoot: a contact for the caller and one conversation per ticket in the
 * "Voice calls" API inbox, with the call transcript as a private note. Status changes flow both ways.
 */
@Injectable()
export class ChatwootConnector implements Connector {
  readonly name = 'chatwoot' as const;
  readonly label = 'Chatwoot';

  constructor(
    @InjectModel(Ticket) private readonly tickets: typeof Ticket,
    @InjectModel(Call) private readonly calls: typeof Call,
  ) {}

  configured() {
    const c = config.chatwoot;
    return Boolean(c.url && c.apiToken && c.accountId && c.inboxId);
  }

  handles(type: string) {
    return type === 'ticket.created' || type === 'ticket.updated';
  }

  private api<T = any>(path: string, method = 'GET', body?: unknown) {
    const c = config.chatwoot;
    return http<T>(`${c.url}/api/v1/accounts/${c.accountId}${path}`, {
      method, body, headers: { api_access_token: c.apiToken },
    });
  }

  async sync(event: OutboxEvent): Promise<string> {
    const ticket = await this.tickets.findByPk(subjectId(event));
    if (!ticket) return 'ticket no longer exists; skipped';
    const ids: ChatwootIds = { ...(ticket.external?.chatwoot ?? {}) };
    const done: string[] = [];
    const inboxId = Number(config.chatwoot.inboxId);

    // A conversation deleted in Chatwoot is recreated.
    if (ids.conversationId) {
      try {
        await this.api(`/conversations/${ids.conversationId}`);
      } catch (e) {
        if (!(e instanceof ConnectorError) || e.status !== 404) throw e;
        ids.conversationId = undefined;
        ids.status = ids.priority = undefined;
      }
    }

    if (!ids.conversationId) {
      const { contactId, sourceId } = await this.contact(ticket, ids.contactId, inboxId);
      ids.contactId = contactId;
      const conv = await this.api('/conversations', 'POST', {
        source_id: sourceId,
        inbox_id: inboxId,
        contact_id: contactId,
        status: TO_CHATWOOT[ticket.status] ?? 'open',
        additional_attributes: { ticket_id: ticket.id, ticket_ref: ticket.ref },
      });
      ids.conversationId = conv.id;
      // The ticket itself shows as the caller's message; the transcript is a private note.
      await this.api(`/conversations/${conv.id}/messages`, 'POST', { content: this.opening(ticket), message_type: 'incoming' });
      ids.status = TO_CHATWOOT[ticket.status] ?? 'open';
      await this.api(`/conversations/${conv.id}/labels`, 'POST', { labels: ['voice', ticket.type] });
      const transcript = await this.transcript(ticket);
      if (transcript) {
        await this.api(`/conversations/${conv.id}/messages`, 'POST', { content: transcript, message_type: 'outgoing', private: true });
      }
      done.push(`conversation ${conv.id} created`);
    }

    const status = TO_CHATWOOT[ticket.status] ?? 'open';
    if (status !== ids.status) {
      await this.api(`/conversations/${ids.conversationId}/toggle_status`, 'POST', { status });
      ids.status = status;
      done.push(`status ${status}`);
    }
    const priority = PRIORITY[ticket.priority] ?? 'medium';
    if (priority !== ids.priority) {
      await this.api(`/conversations/${ids.conversationId}/toggle_priority`, 'POST', { priority });
      ids.priority = priority;
      done.push(`priority ${priority}`);
    }

    ids.syncedAt = new Date().toISOString();
    await ticket.update({ external: { ...ticket.external, chatwoot: ids } }, { hooks: false });
    return done.length ? done.join(', ') : 'already up to date';
  }

  /** Find or create the contact and its link to our inbox. */
  private async contact(ticket: Ticket, knownId: number | undefined, inboxId: number) {
    const phone = ticket.contactPhone ?? undefined;
    const email = ticket.contactEmail ?? undefined;
    let contactId = knownId;
    if (!contactId) {
      for (const term of [phone, email].filter(Boolean) as string[]) {
        const r = await this.api(`/contacts/search?q=${encodeURIComponent(term)}`);
        const hit = (r?.payload ?? []).find((c: any) => c.phone_number === phone || (email && c.email === email));
        if (hit) { contactId = hit.id; break; }
      }
    }
    if (!contactId) {
      const r = await this.api('/contacts', 'POST', {
        name: ticket.contactName || phone || 'Voice caller',
        ...(phone ? { phone_number: phone } : {}),
        ...(email ? { email } : {}),
        inbox_id: inboxId,
      });
      const c = r?.payload?.contact;
      const link = (c?.contact_inboxes ?? []).find((ci: any) => ci.inbox?.id === inboxId);
      if (link?.source_id) return { contactId: c.id as number, sourceId: link.source_id as string };
      contactId = c?.id;
    }
    if (!contactId) throw new ConnectorError('Chatwoot did not return a contact id');
    const r = await this.api(`/contacts/${contactId}/contact_inboxes`, 'POST', { inbox_id: inboxId });
    return { contactId, sourceId: r.source_id as string };
  }

  private opening(t: Ticket): string {
    const lines = [
      `**${t.ref} · ${t.subject}**`,
      t.description ?? '',
      '',
      `Type: ${t.type}${t.preferredCallbackTime ? ` · Preferred callback: ${t.preferredCallbackTime}` : ''}${t.language ? ` · Language: ${t.language}` : ''}`,
      `Open in AudioBots: ${config.publicWebUrl}/admin/tickets/${t.ref}`,
    ];
    return lines.filter((l, i) => l !== '' || i === 2).join('\n');
  }

  private async transcript(t: Ticket): Promise<string | null> {
    if (!t.callId) return null;
    const call = await this.calls.findByPk(t.callId, {
      include: [{ model: CallTurn, separate: true, order: [['turnNo', 'ASC']] }],
    });
    const turns = call?.turns ?? [];
    if (!turns.length) return `Call: ${config.publicWebUrl}/admin/calls/${t.callId}`;
    const lines = turns.flatMap((x) => [
      ...(x.userText ? [`Caller: ${x.userText}`] : []),
      ...(x.agentText ? [`Agent: ${x.agentText}`] : []),
    ]);
    const body = lines.join('\n');
    const clipped = body.length > 6000 ? `${body.slice(0, 6000)}\n…` : body;
    return `Call transcript (${config.publicWebUrl}/admin/calls/${t.callId}):\n\n${clipped}`;
  }

  /**
   * Chatwoot webhook: a support agent changed a conversation's status there. Returns the ticket and
   * the status it should now have (the caller applies it through TicketsService so an event is emitted).
   */
  async inboundStatus(body: Record<string, any>): Promise<{ ticket?: Ticket; next?: string; ignored?: string }> {
    if (body?.event !== 'conversation_status_changed') return { ignored: body?.event ?? 'unknown event' };
    const conversationId = Number(body.id);
    const ticketId = body.additional_attributes?.ticket_id as string | undefined;
    const ticket = (ticketId && await this.tickets.findByPk(ticketId))
      || await this.tickets.findOne({ where: literal(`(external->'chatwoot'->>'conversationId') = '${conversationId | 0}'`) });
    if (!ticket) return { ignored: 'no matching ticket' };
    const next = FROM_CHATWOOT[body.status as string];
    if (!next) return { ignored: `status ${body.status}` };

    // Remember what Chatwoot now shows, so our next sync doesn't toggle it back.
    const ids: ChatwootIds = { ...(ticket.external?.chatwoot ?? {}), status: body.status === 'resolved' ? 'resolved' : 'open' };
    if (body.status === 'pending' || body.status === 'snoozed') ids.status = TO_CHATWOOT.in_progress;
    await ticket.update({ external: { ...ticket.external, chatwoot: ids } }, { hooks: false });

    // closed stays closed when Chatwoot reports resolved
    if (ticket.status === next || (next === 'resolved' && ticket.status === 'closed')) return { ticket, ignored: 'unchanged' };
    return { ticket, next };
  }

  async status(): Promise<ConnectorStatus> {
    const c = config.chatwoot;
    const base: ConnectorStatus = { name: this.name, label: this.label, configured: this.configured(), appUrl: c.publicUrl };
    if (!base.configured) {
      const missing = [
        !c.apiToken && 'CHATWOOT_API_TOKEN', !c.accountId && 'CHATWOOT_ACCOUNT_ID', !c.inboxId && 'CHATWOOT_INBOX_ID',
      ].filter(Boolean) as string[];
      return { ...base, missing };
    }
    try {
      const r = await this.api(`/inboxes/${c.inboxId}`);
      return { ...base, reachable: true, detail: `Connected · inbox "${r?.name ?? c.inboxId}"` };
    } catch (e) {
      const err = e as ConnectorError;
      const detail = err.status === 401 ? 'API token was rejected' : err.status === 404 ? 'Inbox or account not found' : err.message;
      return { ...base, reachable: false, detail };
    }
  }

  recordUrl(record: Lead | Ticket) {
    const ids = (record.external?.chatwoot ?? {}) as ChatwootIds;
    if (!ids.conversationId) return null;
    return `${config.chatwoot.publicUrl}/app/accounts/${config.chatwoot.accountId}/conversations/${ids.conversationId}`;
  }
}
