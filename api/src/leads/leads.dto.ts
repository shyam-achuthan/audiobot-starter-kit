import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ListQuery } from '../common/list-query';
import { LEAD_STATUSES } from '../database/models';

export class UpsertLeadDto {
  @IsOptional() @IsUUID() callId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsOptional() @IsString() @MaxLength(2000) need?: string;
  @IsOptional() @IsString() @MaxLength(200) budget?: string;
  @IsOptional() @IsString() @MaxLength(200) authority?: string;
  @IsOptional() @IsString() @MaxLength(200) timeline?: string;
  @IsOptional() @IsString() @MaxLength(100) teamSize?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number;
  @IsOptional() @IsIn(LEAD_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(200) preferredCallbackTime?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class ListLeadsQuery extends ListQuery {
  @IsOptional() @IsIn(LEAD_STATUSES) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minScore?: number;
}
