import {
  Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentTokenGuard } from '../common/agent-token.guard';
import { UpsertLeadDto } from './leads.dto';
import { LeadsService } from './leads.service';

@Controller('v1/leads')
@UseGuards(AgentTokenGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  create(@Body() dto: UpsertLeadDto) {
    return this.leads.create(dto);
  }

  @Get()
  list(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.leads.list(limit);
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
