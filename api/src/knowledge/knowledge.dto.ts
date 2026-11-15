import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { WORKFLOWS } from '../config';

export class CreateKbDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(64) embeddingModel?: string;
  @IsOptional() @IsIn([768, 1024, 1536]) dimension?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsIn(WORKFLOWS, { each: true }) workflows?: string[];
}

export class UpdateKbDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(64) embeddingModel?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsIn(WORKFLOWS, { each: true }) workflows?: string[];
}

export class AddFaqDto {
  @IsString() @MinLength(2) @MaxLength(500) question!: string;
  @IsString() @MinLength(1) @MaxLength(4000) answer!: string;
}

export class AddUrlDto {
  @IsString() @MaxLength(2000) url!: string;
  // When the URL is a sitemap, index up to this many pages from it.
  @IsOptional() @IsInt() @Min(1) @Max(200) maxPages?: number;
}

export class SearchDto {
  @IsString() @MinLength(1) @MaxLength(1000) query!: string;
  @IsOptional() @IsIn(WORKFLOWS) workflow?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) kbIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(20) topK?: number;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) companyName?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(120) industry?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(300) supportHours?: string;
  @IsOptional() @IsString() @MaxLength(300) callbackHours?: string;
  @IsOptional() @IsString() @MaxLength(4000) extraInstructions?: string;
  @IsOptional() @IsBoolean() setupCompleted?: boolean;
}
