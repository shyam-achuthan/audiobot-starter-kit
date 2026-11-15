import { timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, Ip, Post } from '@nestjs/common';
import { config, WORKFLOWS, Workflow } from '../config';
import { normalizeOrigin, WidgetsService } from '../widgets/widgets.service';
import { LivekitService } from './livekit.service';

interface TokenRequest {
  workflow?: string;
  name?: string;
}

@Controller('v1/livekit')
export class LivekitController {
  constructor(private readonly livekit: LivekitService, private readonly widgets: WidgetsService) {}

  private serverToken(auth: string | undefined) {
    const t = Buffer.from((auth ?? '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(config.agentApiToken);
    return t.length === want.length && timingSafeEqual(t, want);
  }

  /**
   * Token for the demo page (and server-side tests). Websites use widgets (/v1/widget/session);
   * this endpoint only serves our own origins or the server token.
   */
  @Post('token')
  async token(
    @Body() body: TokenRequest = {},
    @Headers('origin') origin?: string,
    @Headers('authorization') auth?: string,
    @Headers('x-forwarded-host') forwardedHost?: string,
    @Ip() ip = '',
  ) {
    if (!this.serverToken(auth)) {
      const o = origin ? normalizeOrigin(origin) : null;
      if (!this.widgets.isFirstParty(o, forwardedHost)) {
        throw new ForbiddenException('Use a widget key to start calls from other websites');
      }
      this.widgets.limitIp(ip);
    }
    const workflow = (body.workflow ?? 'router') as Workflow;
    if (!WORKFLOWS.includes(workflow)) {
      throw new BadRequestException(`workflow must be one of: ${WORKFLOWS.join(', ')}`);
    }
    const name = typeof body.name === 'string' ? body.name.slice(0, 64) : undefined;
    return this.livekit.createWebSession({ workflow, name });
  }
}
