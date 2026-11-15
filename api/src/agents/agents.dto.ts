import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsNumber, Matches, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

/**
 * Per-agent settings an admin can change. Every field is optional; null clears the override
 * (the agent's built-in default applies again).
 */
export class AgentOverridesDto {
  @IsOptional() @IsString() @MaxLength(8000) role?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) greeting?: string | null;
  @IsOptional() @IsString() @MaxLength(64) llmModel?: string | null;
  @IsOptional() @IsString() @MaxLength(64) ttsSpeaker?: string | null;
  @IsOptional() @IsNumber() @Min(0.5) @Max(2) ttsPace?: number | null;
  @IsOptional() @IsNumber() @Min(0.1) @Max(3) endpointingMinDelay?: number | null;
  @IsOptional() @IsNumber() @Min(0.3) @Max(6) endpointingMaxDelay?: number | null;
  @IsOptional() @IsBoolean() allowInterruptions?: boolean | null;
  @IsOptional() @IsNumber() @Min(0.1) @Max(2) interruptionMinDuration?: number | null;
  /** off = never record; notice = record and tell the caller they can opt out; ask = record only after a yes. */
  @IsOptional() @IsIn(['off', 'notice', 'ask']) recordingConsent?: 'off' | 'notice' | 'ask' | null;
  /** Human number for live transfers on phone calls (E.164, or a sip: URI). Empty = no transfer. */
  @IsOptional() @IsString() @Matches(/^(\+\d{8,15}|sip:\S+)?$/, { message: 'use +91XXXXXXXXXX or a sip: address' }) transferNumber?: string | null;
}

export const OVERRIDE_KEYS = [
  'role', 'greeting', 'llmModel', 'ttsSpeaker', 'ttsPace',
  'endpointingMinDelay', 'endpointingMaxDelay', 'allowInterruptions', 'interruptionMinDuration',
  'recordingConsent', 'transferNumber',
] as const;

export class SpeakerDto {
  @IsString() @MaxLength(64) id!: string;
  @IsOptional() @IsString() @MaxLength(16) gender?: string;
}

/** Sent by the agent worker on startup: its built-in defaults per workflow and the voices it offers. */
export class ReportDefaultsDto {
  @IsObject() agents!: Record<string, Record<string, unknown>>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SpeakerDto) ttsSpeakers?: SpeakerDto[];
  @IsOptional() @IsString() @MaxLength(64) ttsModel?: string;
}
