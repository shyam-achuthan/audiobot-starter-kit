import {
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AgentOnly, ApiAuthGuard } from '../auth/auth.guard';
import { CreateTicketDto, UpdateTicketDto, ListTicketsQuery } from './tickets.dto';
import { TicketsService } from './tickets.service';

@Controller('v1/tickets')
@UseGuards(ApiAuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @AgentOnly()
  @Post()
  create(@Body() dto: CreateTicketDto) {
    return this.tickets.create(dto);
  }

  @Get()
  list(@Query() q: ListTicketsQuery) {
    return this.tickets.list(q);
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
