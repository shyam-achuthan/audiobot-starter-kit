import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';
import { WORKFLOWS } from '../config';
import { ListQuery } from '../common/list-query';
import { CALL_OUTCOMES, CALL_STATUSES } from '../database/models';

export class CreateCallDto {
  @IsString() @MaxLength(128) room!: string;
  @IsOptional() @IsIn(['web', 'sip']) channel?: string;
  @IsIn(WORKFLOWS) workflow!: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
}

export class UpdateCallDto {
  @IsOptional() @IsIn(CALL_STATUSES) status?: string;
  @IsOptional() @IsIn(CALL_OUTCOMES) outcome?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsIn(WORKFLOWS, { each: true }) agentPath?: string[];
  @IsOptional() @IsString() @MaxLength(120) callerName?: string;
  @IsOptional() @IsString() @MaxLength(40) callerPhone?: string;
  @IsOptional() @IsEmail() callerEmail?: string;
}

export class CreateTurnDto {
  @IsInt() @Min(1) turnNo!: number;
  @IsOptional() @IsString() @MaxLength(32) agent?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsString() @MaxLength(8000) userText?: string;
  @IsOptional() @IsString() @MaxLength(8000) agentText?: string;
  @IsOptional() @IsBoolean() interrupted?: boolean;
  @IsOptional() @IsInt() eotMs?: number;
  @IsOptional() @IsInt() sttMs?: number;
  @IsOptional() @IsInt() llmTtftMs?: number;
  @IsOptional() @IsInt() ttsTtfbMs?: number;
  @IsOptional() @IsInt() e2eMs?: number;
}

export class ListCallsQuery extends ListQuery {
  @IsOptional() @IsIn(CALL_STATUSES) status?: (typeof CALL_STATUSES)[number];
  @IsOptional() @IsIn(CALL_OUTCOMES) outcome?: (typeof CALL_OUTCOMES)[number];
  @IsOptional() @IsIn(WORKFLOWS) workflow?: string;
  @IsOptional() @IsIn(['web', 'sip']) channel?: string;
}
