import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Logger, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiAuthGuard, AuthedRequest, OwnerOnly, actorOf } from '../auth/auth.guard';
import { config } from '../config';
import { TicketsService } from '../tickets/tickets.service';
import { ChatwootConnector } from './connectors/chatwoot';
import { CreateEndpointDto, ListDeliveriesQuery, UpdateEndpointDto } from './integrations.dto';
import { IntegrationsService } from './integrations.service';

/** Webhooks + connectors. Owner only: endpoints hold signing secrets and receive customer data. */
@Controller('v1/integrations')
@UseGuards(ApiAuthGuard)
@OwnerOnly()
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get()
  overview() {
    return this.svc.overview();
  }

  @Post('webhooks')
  create(@Body() dto: CreateEndpointDto, @Req() req: AuthedRequest) {
    return this.svc.create(dto, actorOf(req));
  }

  @Patch('webhooks/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEndpointDto) {
    return this.svc.update(id, dto);
  }

  @Delete('webhooks/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }

  @Get('webhooks/:id/secret')
  secret(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.secret(id);
  }

  @Post('webhooks/:id/rotate-secret')
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.rotateSecret(id);
  }

  @Post('webhooks/:id/test')
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.test(id);
  }

  @Get('deliveries')
  deliveries(@Query() q: ListDeliveriesQuery) {
    return this.svc.listDeliveries(q);
  }

  @Get('deliveries/:id')
  delivery(@Param('id') id: string) {
    return this.svc.delivery(id);
  }

  @Post('deliveries/:id/retry')
  retry(@Param('id') id: string) {
    return this.svc.retry(id);
  }

  @Post('connectors/:name/backfill')
  backfill(@Param('name') name: string) {
    return this.svc.backfill(name);
  }
}

/**
 * Chatwoot calls this when a conversation changes (status set by a support agent in Chatwoot),
 * so the ticket status the voice agent reads stays current. Authenticated by a secret in the URL.
 */
@Controller('v1/integrations/chatwoot')
export class ChatwootInboundController {
  private readonly log = new Logger('ChatwootInbound');
  constructor(private readonly chatwoot: ChatwootConnector, private readonly tickets: TicketsService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Query('token') token: string, @Body() body: Record<string, any>) {
    const want = Buffer.from(config.chatwoot.webhookToken);
    const got = Buffer.from(token ?? '');
    if (!want.length || got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new ForbiddenException('bad token');
    }
    try {
      const r = await this.chatwoot.inboundStatus(body);
      if (!r.ticket || !r.next) return { ok: true, ignored: r.ignored };
      await this.tickets.update(r.ticket.id, { status: r.next as any }, { source: 'chatwoot' });
      this.log.log(`${r.ticket.ref} -> ${r.next} (changed in Chatwoot)`);
      return { ok: true, status: r.next };
    } catch (e) {
      this.log.warn(`inbound ${body?.event}: ${(e as Error).message}`);
      return { ok: false };
    }
  }
}
