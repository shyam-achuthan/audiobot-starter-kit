import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { actorOf, AgentOnly, ApiAuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { AgentOverridesDto, ReportDefaultsDto } from './agents.dto';
import { AgentsService } from './agents.service';

/**
 * Per-agent settings (prompt, model, voice, turn timing). The agent worker reads them at the
 * start of every call, so changes apply to the next call without a redeploy.
 */
@Controller('v1/agents')
@UseGuards(ApiAuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list() {
    return this.agents.list();
  }

  @Get('options')
  options() {
    return this.agents.options();
  }

  @AgentOnly()
  @Put('defaults')
  report(@Body() dto: ReportDefaultsDto) {
    return this.agents.reportDefaults(dto);
  }

  @Get(':workflow')
  get(@Param('workflow') workflow: string) {
    return this.agents.get(workflow);
  }

  @Put(':workflow')
  update(@Param('workflow') workflow: string, @Body() dto: AgentOverridesDto, @Req() req: AuthedRequest) {
    return this.agents.update(workflow, dto, actorOf(req));
  }

  @Delete(':workflow/overrides')
  reset(@Param('workflow') workflow: string, @Req() req: AuthedRequest) {
    return this.agents.reset(workflow, actorOf(req));
  }
}
