import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentOnly, ApiAuthGuard } from '../auth/auth.guard';
import { CreateCallDto, CreateTurnDto, UpdateCallDto, ListCallsQuery } from './calls.dto';
import { CallsService } from './calls.service';
import { config } from '../config';
import { RecordingsService } from '../recordings/recordings.service';

@Controller('v1/calls')
@UseGuards(ApiAuthGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @AgentOnly()
  @Post()
  create(@Body() dto: CreateCallDto) {
    return this.calls.create(dto);
  }

  @Get()
  list(@Query() q: ListCallsQuery) {
    return this.calls.list(q);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const call = await this.calls.get(id);
    const { egressId: _e, recordingKey: _k, ...rest } = call.toJSON();
    const lf = config.langfuse;
    return {
      ...rest,
      recording: RecordingsService.summary(call),
      // One Langfuse session per call (LiteLLM tags every request with the call id).
      traceUrl: lf.publicUrl ? `${lf.publicUrl}/project/${lf.projectId}/sessions/${encodeURIComponent(call.id)}` : null,
    };
  }

  @AgentOnly()
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCallDto) {
    return this.calls.update(id, dto);
  }

  @AgentOnly()
  @Post(':id/turns')
  addTurn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTurnDto) {
    return this.calls.addTurn(id, dto);
  }
}
