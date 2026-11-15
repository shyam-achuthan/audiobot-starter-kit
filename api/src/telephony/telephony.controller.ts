import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiAuthGuard, AgentOnly, AuthedRequest, OwnerOnly, actorOf } from '../auth/auth.guard';
import { OutboundCallDto } from '../calls/calls.dto';
import { WORKFLOWS } from '../config';
import { TelephonyService } from './telephony.service';

export class PhoneNumberDto {
  @IsOptional() @IsString() @MaxLength(40) number?: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string | null;
  @IsOptional() @IsIn(WORKFLOWS) workflow?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class DndAddDto {
  /** One or more numbers: one per line, or comma separated (CSV works). */
  @IsString() @MaxLength(200_000) numbers!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export class PhoneRulesDto {
  @IsOptional() @Matches(HHMM, { message: 'use HH:MM (24-hour)' }) outboundHoursStart?: string;
  @IsOptional() @Matches(HHMM, { message: 'use HH:MM (24-hour)' }) outboundHoursEnd?: string;
  @IsOptional() @IsBoolean() autoCallbacks?: boolean;
}

/** Admin -> Phone: numbers, outbound rules and the do-not-call list (owners only). */
@Controller('v1/phone')
@UseGuards(ApiAuthGuard)
export class PhoneController {
  constructor(private readonly telephony: TelephonyService) {}

  @Get()
  status() {
    return this.telephony.status();
  }

  /** The voice agent looks up which agent answers a dialled number. */
  @AgentOnly()
  @Get('lookup')
  lookup(@Query('number') number: string) {
    return this.telephony.lookup(number ?? '');
  }

  @Get('numbers')
  numbers() {
    return this.telephony.listNumbers();
  }

  @OwnerOnly()
  @Post('numbers')
  addNumber(@Body() dto: PhoneNumberDto) {
    return this.telephony.saveNumber(null, dto);
  }

  @OwnerOnly()
  @Put('numbers/:id')
  updateNumber(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PhoneNumberDto) {
    return this.telephony.saveNumber(id, dto);
  }

  @OwnerOnly()
  @Delete('numbers/:id')
  deleteNumber(@Param('id', ParseUUIDPipe) id: string) {
    return this.telephony.deleteNumber(id);
  }

  @OwnerOnly()
  @Put('rules')
  rules(@Body() dto: PhoneRulesDto) {
    return this.telephony.updateRules(dto);
  }

  @Get('dnd')
  dnd(@Query('q') q?: string) {
    return this.telephony.listDnd(q);
  }

  @OwnerOnly()
  @Post('dnd')
  addDnd(@Body() dto: DndAddDto, @Req() req: AuthedRequest) {
    return this.telephony.addDnd(dto.numbers, dto.note?.trim() || null, actorOf(req));
  }

  @OwnerOnly()
  @Delete('dnd/:number')
  removeDnd(@Param('number') number: string) {
    return this.telephony.removeDnd(number);
  }
}

/** Start an outbound call: dashboard "Call now", a CRM or a script (admin session or server token). */
@Controller('v1/calls/outbound')
@UseGuards(ApiAuthGuard)
export class OutboundController {
  constructor(private readonly telephony: TelephonyService) {}

  @Post()
  dial(@Body() dto: OutboundCallDto, @Req() req: AuthedRequest) {
    return this.telephony.dial(dto, actorOf(req));
  }

  /** Whether a call to this number/ticket could be placed now (for the dashboard button). */
  @Get('check')
  async check(@Query('phone') phone?: string, @Query('ticketRef') ticketRef?: string) {
    return { blocked: await this.telephony.checkFor(phone, ticketRef) };
  }
}
