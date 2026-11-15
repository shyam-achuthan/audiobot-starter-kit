import { Type } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { CONNECTORS, DELIVERY_STATUSES, EVENT_TYPES } from '../database/models';

const URL_OPTS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };

export class CreateEndpointDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsUrl(URL_OPTS, { message: 'url must be an http(s) URL' }) @MaxLength(2000) url!: string;
  /** Empty or omitted = all events. */
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(EVENT_TYPES, { each: true }) events?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateEndpointDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsUrl(URL_OPTS, { message: 'url must be an http(s) URL' }) @MaxLength(2000) url?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(EVENT_TYPES, { each: true }) events?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class ListDeliveriesQuery {
  @IsOptional() @IsUUID() endpointId?: string;
  @IsOptional() @IsIn(CONNECTORS) connector?: string;
  @IsOptional() @IsIn([...DELIVERY_STATUSES, 'failing']) status?: string;
  @IsOptional() @IsString() @MaxLength(48) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
