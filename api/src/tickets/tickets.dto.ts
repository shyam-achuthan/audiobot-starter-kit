import {
  IsEmail, IsISO8601, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf,
} from 'class-validator';
import { ListQuery } from '../common/list-query';
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from '../database/models';

export class CreateTicketDto {
  @IsOptional() @IsUUID() callId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsIn(TICKET_TYPES) type?: string;
  @IsString() @MaxLength(300) subject!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(200) preferredCallbackTime?: string;
  /** When to call back, ISO 8601 with offset (e.g. 2026-11-16T16:00:00+05:30). Drives scheduled callbacks. */
  @IsOptional() @IsISO8601() callbackAt?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(TICKET_STATUSES) status?: string;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  /** Reschedule (or clear with null) the callback; resets the attempt counter. */
  @IsOptional() @ValidateIf((o) => o.callbackAt !== null) @IsISO8601() callbackAt?: string | null;
}

export class ListTicketsQuery extends ListQuery {
  @IsOptional() @IsIn([...TICKET_STATUSES, 'active']) status?: string; // active = open + in_progress
  @IsOptional() @IsIn(TICKET_TYPES) type?: string;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: string;
}
