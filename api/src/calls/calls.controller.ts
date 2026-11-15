import {
  Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentOnly, ApiAuthGuard } from '../auth/auth.guard';
import { CreateCallDto, CreateTurnDto, UpdateCallDto } from './calls.dto';
import { CallsService } from './calls.service';

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
  list(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.calls.list(limit);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.calls.get(id);
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
