import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { config } from '../../config';
import { Lead, OutboxEvent, Ticket } from '../../database/models';
import { Connector, ConnectorError, ConnectorStatus, http, subjectId } from './connector';

/** Lead status -> Twenty opportunity stage. Unqualified leads get no opportunity. */
const STAGE: Record<string, string | undefined> = {
  new: 'NEW',
  qualified: 'SCREENING',
  callback: 'MEETING',
};

type TwentyIds = {
  personId?: string;
  companyId?: string;
  opportunityId?: string;
  noteId?: string;
  /** Last stage we pushed; we only push again when our mapped stage changes, so moves made in Twenty stick. */
  stage?: string;
  syncedAt?: string;
};

/** "+919845012345" -> Twenty's phone shape. Indian numbers get the IN country code. */
export function twentyPhone(e164: string) {
  if (e164.startsWith('+91') && e164.length === 13) {
    return { primaryPhoneNumber: e164.slice(3), primaryPhoneCountryCode: 'IN', primaryPhoneCallingCode: '+91' };
  }
  return { primaryPhoneNumber: e164.replace(/^\+/, ''), primaryPhoneCountryCode: '', primaryPhoneCallingCode: '' };
}

export function splitName(name: string | null): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Unknown caller', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

/**
 * Mirrors leads into Twenty CRM: a Person (+ Company when the caller named one), an Opportunity
 * with a stage from the lead status, and one Note with the qualification answers that is kept up to date.
 */
@Injectable()
export class TwentyConnector implements Connector {
  readonly name = 'twenty' as const;
  readonly label = 'Twenty CRM';

  constructor(@InjectModel(Lead) private readonly leads: typeof Lead) {}

  configured() {
    return Boolean(config.twenty.apiKey && config.twenty.url);
  }

  handles(type: string) {
    return type === 'lead.created' || type === 'lead.updated';
  }

  private api<T = any>(path: string, method = 'GET', body?: unknown) {
    return http<T>(`${config.twenty.url}/rest${path}`, {
      method, body, headers: { authorization: `Bearer ${config.twenty.apiKey}` },
    });
  }

  private async findOne(object: string, filter: string): Promise<{ id: string } | null> {
    const r = await this.api(`/${object}?limit=1&filter=${encodeURIComponent(filter)}`);
    return r?.data?.[object]?.[0] ?? null;
  }

  /** PATCH if we have an id and it still exists in Twenty, otherwise create. Returns the id. */
  private async upsert(object: string, id: string | undefined, body: Record<string, unknown>, find?: () => Promise<{ id: string } | null>) {
    if (id) {
      try {
        await this.api(`/${object}/${id}`, 'PATCH', body);
        return id;
      } catch (e) {
        if (!(e instanceof ConnectorError) || (e.status !== 404 && e.status !== 400)) throw e;
        // Deleted in Twenty: fall through and recreate.
      }
    }
    const existing = find ? await find() : null;
    if (existing) {
      await this.api(`/${object}/${existing.id}`, 'PATCH', body);
      return existing.id;
    }
    const created = await this.api(`/${object}`, 'POST', body);
    const record = Object.values(created?.data ?? {})[0] as { id?: string } | undefined;
    if (!record?.id) throw new ConnectorError(`Twenty did not return an id for the new ${object}`);
    return record.id;
  }

  async sync(event: OutboxEvent): Promise<string> {
    const lead = await this.leads.findByPk(subjectId(event));
    if (!lead) return 'lead no longer exists; skipped';
    const ids: TwentyIds = { ...(lead.external?.twenty ?? {}) };
    const done: string[] = [];

    if (lead.company?.trim()) {
      const name = lead.company.trim();
      ids.companyId = await this.upsert('companies', ids.companyId, { name },
        () => this.findOne('companies', `name[ilike]:${q(name)}`));
      done.push('company');
    }

    const person: Record<string, unknown> = {};
    if (lead.name) person.name = splitName(lead.name);
    else if (!ids.personId) person.name = splitName(null);
    if (lead.email) person.emails = { primaryEmail: lead.email, additionalEmails: [] };
    if (lead.phone) person.phones = { ...twentyPhone(lead.phone), additionalPhones: [] };
    if (ids.companyId) person.companyId = ids.companyId;
    ids.personId = await this.upsert('people', ids.personId, person, async () =>
      (lead.email && await this.findOne('people', `emails.primaryEmail[eq]:${q(lead.email)}`))
      || (lead.phone && await this.findOne('people', `phones.primaryPhoneNumber[eq]:${q(twentyPhone(lead.phone).primaryPhoneNumber)}`))
      || null);
    done.push('person');

    const stage = STAGE[lead.status];
    if (stage || ids.opportunityId) {
      const opp: Record<string, unknown> = {
        name: `${lead.company?.trim() || lead.name || 'Caller'} (voice lead)`,
        pointOfContactId: ids.personId,
        ...(ids.companyId ? { companyId: ids.companyId } : {}),
      };
      if (stage && stage !== ids.stage) opp.stage = stage;
      ids.opportunityId = await this.upsert('opportunities', ids.opportunityId, opp);
      if (opp.stage) ids.stage = stage;
      done.push(`opportunity${opp.stage ? ` (${stage})` : ''}`);
    }

    const note = { title: `Voice lead: ${lead.name ?? lead.phone ?? 'caller'}`, bodyV2: { markdown: this.noteBody(lead) } };
    const isNew = !ids.noteId;
    ids.noteId = await this.upsert('notes', ids.noteId, note);
    if (isNew) {
      const targets = [
        { targetPersonId: ids.personId },
        ...(ids.opportunityId ? [{ targetOpportunityId: ids.opportunityId }] : []),
        ...(ids.companyId ? [{ targetCompanyId: ids.companyId }] : []),
      ];
      for (const t of targets) await this.api('/noteTargets', 'POST', { noteId: ids.noteId, ...t });
    }
    done.push('note');

    ids.syncedAt = new Date().toISOString();
    await lead.update({ external: { ...lead.external, twenty: ids } }, { hooks: false });
    return `synced ${done.join(', ')}`;
  }

  private noteBody(lead: Lead): string {
    const row = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? [] : [`- **${k}:** ${v}`]);
    return [
      `Captured by the voice agent${lead.language ? ` (language: ${lead.language})` : ''}.`,
      '',
      ...row('Status', lead.status),
      ...row('Score', lead.score != null ? `${lead.score}/100` : null),
      ...row('Need', lead.need),
      ...row('Budget', lead.budget),
      ...row('Decision maker', lead.authority),
      ...row('Timeline', lead.timeline),
      ...row('Team size', lead.teamSize),
      ...row('Preferred callback', lead.preferredCallbackTime),
      ...row('Notes', lead.notes),
      '',
      `[Open lead in AudioBots](${config.publicWebUrl}/admin/leads/${lead.id})`
        + (lead.callId ? ` · [Call transcript](${config.publicWebUrl}/admin/calls/${lead.callId})` : ''),
    ].join('\n');
  }

  async status(): Promise<ConnectorStatus> {
    const base: ConnectorStatus = { name: this.name, label: this.label, configured: this.configured(), appUrl: config.twenty.publicUrl };
    if (!base.configured) return { ...base, missing: ['TWENTY_API_KEY'] };
    try {
      await this.api('/people?limit=1');
      return { ...base, reachable: true, detail: 'Connected' };
    } catch (e) {
      const err = e as ConnectorError;
      const detail = err.status === 401 || err.status === 403 ? 'API key was rejected' : err.message;
      return { ...base, reachable: false, detail };
    }
  }

  recordUrl(record: Lead | Ticket) {
    const ids = (record.external?.twenty ?? {}) as TwentyIds;
    if (ids.opportunityId) return `${config.twenty.publicUrl}/object/opportunity/${ids.opportunityId}`;
    if (ids.personId) return `${config.twenty.publicUrl}/object/person/${ids.personId}`;
    return null;
  }
}
