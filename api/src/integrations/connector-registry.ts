import { Injectable } from '@nestjs/common';
import type { Lead, Ticket } from '../database/models';
import { Connector } from './connectors/connector';
import { ChatwootConnector } from './connectors/chatwoot';
import { TwentyConnector } from './connectors/twenty';

@Injectable()
export class ConnectorRegistry {
  constructor(readonly twenty: TwentyConnector, readonly chatwoot: ChatwootConnector) {}

  all(): Connector[] {
    return [this.twenty, this.chatwoot];
  }

  /** The record plus links to where it was synced (for the dashboard detail pages). */
  withLinks(record: Lead | Ticket) {
    const crmLinks = this.all()
      .map((c) => ({ name: c.name, label: c.label, url: c.recordUrl(record) }))
      .filter((l) => l.url);
    return { ...(record.toJSON() as object), crmLinks };
  }

  get(name: string): Connector | undefined {
    return this.all().find((c) => c.name === name);
  }
}
