import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentOnly, ApiAuthGuard } from '../auth/auth.guard';
import { ConnectorRegistry } from '../integrations/connector-registry';
import { UpsertLeadDto, ListLeadsQuery } from './leads.dto';
import { LeadsService } from './leads.service';

@Controller('v1/leads')
@UseGuards(ApiAuthGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService, private readonly connectors: ConnectorRegistry) {}

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
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectors.withLinks(await this.leads.get(id));
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertLeadDto) {
    return this.connectors.withLinks(await this.leads.update(id, dto));
  }
}
