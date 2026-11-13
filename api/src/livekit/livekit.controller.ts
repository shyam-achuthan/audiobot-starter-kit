import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { WORKFLOWS, Workflow } from '../config';
import { LivekitService } from './livekit.service';

interface TokenRequest {
  workflow?: string;
  name?: string;
}

@Controller('v1/livekit')
export class LivekitController {
  constructor(private readonly livekit: LivekitService) {}

  @Post('token')
  async token(@Body() body: TokenRequest = {}) {
    const workflow = (body.workflow ?? 'router') as Workflow;
    if (!WORKFLOWS.includes(workflow)) {
      throw new BadRequestException(`workflow must be one of: ${WORKFLOWS.join(', ')}`);
    }
    const name = typeof body.name === 'string' ? body.name.slice(0, 64) : undefined;
    return this.livekit.createWebSession({ workflow, name });
  }
}
