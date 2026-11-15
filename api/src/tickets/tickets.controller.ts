import {
  Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentTokenGuard } from '../common/agent-token.guard';
import { CreateTicketDto, UpdateTicketDto } from './tickets.dto';
import { TicketsService } from './tickets.service';

@Controller('v1/tickets')
@UseGuards(AgentTokenGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(@Body() dto: CreateTicketDto) {
    return this.tickets.create(dto);
  }

  @Get()
  list(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.tickets.list(limit);
  }

  // Declared before ':ref' so "lookup" isn't treated as a ticket reference.
  @Get('lookup')
  lookup(@Query('ref') ref?: string, @Query('phone') phone?: string) {
    return this.tickets.lookup({ ref, phone });
  }

  @Get(':ref')
  get(@Param('ref') ref: string) {
    return this.tickets.find(ref);
  }

  @Patch(':ref')
  update(@Param('ref') ref: string, @Body() dto: UpdateTicketDto) {
    return this.tickets.update(ref, dto);
  }
}
