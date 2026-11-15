import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentOnly, ApiAuthGuard } from '../auth/auth.guard';
import { UpsertLeadDto, ListLeadsQuery } from './leads.dto';
import { LeadsService } from './leads.service';

@Controller('v1/leads')
@UseGuards(ApiAuthGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @AgentOnly()
  @Post()
  create(@Body() dto: UpsertLeadDto) {
    return this.leads.create(dto);
  }

  @Get()
  list(@Query() q: ListLeadsQuery) {
    return this.leads.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertLeadDto) {
    return this.leads.update(id, dto);
  }
}
