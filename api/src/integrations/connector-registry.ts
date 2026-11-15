import { Injectable } from '@nestjs/common';
import { Connector } from './connectors/connector';
import { ChatwootConnector } from './connectors/chatwoot';
import { TwentyConnector } from './connectors/twenty';

@Injectable()
export class ConnectorRegistry {
  constructor(readonly twenty: TwentyConnector, readonly chatwoot: ChatwootConnector) {}

  all(): Connector[] {
    return [this.twenty, this.chatwoot];
  }

  get(name: string): Connector | undefined {
    return this.all().find((c) => c.name === name);
  }
}
