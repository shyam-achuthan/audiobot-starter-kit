import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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
  @IsOptional() @IsString() @MaxLength(8) language?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(TICKET_STATUSES) status?: string;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
}
