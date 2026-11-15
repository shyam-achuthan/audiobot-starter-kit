import {
  Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Res, UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AgentOnly, ApiAuthGuard, OwnerOnly } from '../auth/auth.guard';
import { BusinessProfile } from '../database/models';
import { RecordingsService } from './recordings.service';

export class RecordingActionDto {
  /** start: begin recording; stop: end it and keep the file; discard: end it and delete the file. */
  @IsIn(['start', 'stop', 'discard']) action!: 'start' | 'stop' | 'discard';
  @IsOptional() @IsIn(['notice', 'ask']) consent?: 'notice' | 'ask';
}

export class RetentionDto {
  /** Days to keep call recordings; null = forever. */
  @ValidateIf((o) => o.recordingRetentionDays !== null)
  @Type(() => Number) @IsInt() @Min(1) @Max(3650) recordingRetentionDays!: number | null;
  /** Days to keep transcript text; null = forever. */
  @ValidateIf((o) => o.transcriptRetentionDays !== null)
  @Type(() => Number) @IsInt() @Min(1) @Max(3650) transcriptRetentionDays!: number | null;
}

@Controller('v1/calls')
@UseGuards(ApiAuthGuard)
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  /** The voice agent starts/stops recording as the caller's consent dictates. */
  @AgentOnly()
  @Post(':id/recording')
  action(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordingActionDto) {
    if (dto.action === 'start') return this.recordings.start(id, dto.consent ?? 'notice');
    return this.recordings.stop(id, dto.action === 'discard');
  }

  /** Streams the recording (supports Range requests so the player can seek). */
  @Get(':id/recording/audio')
  async audio(@Param('id', ParseUUIDPipe) id: string, @Headers('range') range: string | undefined, @Res() res: Response) {
    const r = await this.recordings.stream(id, range);
    res.status(r.partial ? 206 : 200);
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    r.body.pipe(res);
  }

  @OwnerOnly()
  @Delete(':id/recording')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.recordings.remove(id);
  }
}

/** Org-wide data retention (Admin -> Settings). Reading is open to admins; changing needs an owner. */
@Controller('v1/settings/retention')
@UseGuards(ApiAuthGuard)
export class RetentionController {
  constructor(
    @InjectModel(BusinessProfile) private readonly profiles: typeof BusinessProfile,
    private readonly recordings: RecordingsService,
  ) {}

  private async row() {
    const [p] = await this.profiles.findOrCreate({ where: { id: 1 }, defaults: { id: 1, companyName: 'AudioBots Demo' } });
    return p;
  }

  private view(p: BusinessProfile) {
    return { recordingRetentionDays: p.recordingRetentionDays, transcriptRetentionDays: p.transcriptRetentionDays };
  }

  @Get()
  async get() {
    return this.view(await this.row());
  }

  @OwnerOnly()
  @Put()
  async update(@Body() dto: RetentionDto) {
    const p = await this.row();
    await p.update({ recordingRetentionDays: dto.recordingRetentionDays, transcriptRetentionDays: dto.transcriptRetentionDays });
    void this.recordings.prune(); // apply right away
    return this.view(p);
  }
}
