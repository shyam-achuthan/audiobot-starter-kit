import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EgressClient, EgressStatus, EncodedFileOutput, EncodedFileType } from 'livekit-server-sdk';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { config } from '../config';
import { BusinessProfile, Call, RecordingConsent } from '../database/models';

const RECONCILE_MS = 10_000;
const PRUNE_MS = 60 * 60_000;
// Statuses whose egress we still need to check on.
const OPEN = ['recording', 'processing', 'declined'] as const;

export type RecordingSummary = {
  status: Call['recordingStatus'];
  consent: RecordingConsent | null;
  durationMs: number | null;
  bytes: number | null;
  error: string | null;
  /** Relative API path that streams the audio; only when status is "ready". */
  audioPath: string | null;
};

/**
 * Call recordings: LiveKit Egress records the room as one mixed OGG/Opus file into RustFS.
 * The agent decides when (consent), this service starts/stops egress, tracks it until the file
 * is uploaded, streams it to the dashboard and applies the org's retention settings.
 */
@Injectable()
export class RecordingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Recordings');
  private readonly egress = new EgressClient(
    config.livekit.url.replace(/^ws/, 'http'), config.livekit.apiKey, config.livekit.apiSecret,
  );
  private readonly s3 = new S3Client({
    endpoint: config.recordings.s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: config.recordings.accessKey, secretAccessKey: config.recordings.secretKey },
  });
  private timers: NodeJS.Timeout[] = [];
  private busy = false;

  constructor(
    @InjectModel(Call) private readonly calls: typeof Call,
    @InjectModel(BusinessProfile) private readonly profiles: typeof BusinessProfile,
    private readonly sequelize: Sequelize,
  ) {}

  onModuleInit() {
    if (process.env.RECORDING_WORKER === 'false') return;
    this.timers.push(setInterval(() => void this.reconcile(), RECONCILE_MS));
    this.timers.push(setTimeout(() => void this.prune(), 60_000));
    this.timers.push(setInterval(() => void this.prune(), PRUNE_MS));
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  static summary(call: Call): RecordingSummary {
    return {
      status: call.recordingStatus,
      consent: call.recordingConsent,
      durationMs: call.recordingDurationMs,
      bytes: call.recordingBytes == null ? null : Number(call.recordingBytes),
      error: call.recordingError,
      audioPath: call.recordingStatus === 'ready' ? `/v1/calls/${call.id}/recording/audio` : null,
    };
  }

  private async find(id: string) {
    const call = await this.calls.findByPk(id);
    if (!call) throw new NotFoundException('call not found');
    return call;
  }

  /** Start recording the call's room (idempotent). Failures are stored, never thrown at the agent. */
  async start(id: string, consent: RecordingConsent) {
    const call = await this.find(id);
    if (['recording', 'processing', 'ready'].includes(call.recordingStatus)) return RecordingsService.summary(call);
    if (!config.recordings.enabled) {
      await call.update({ recordingStatus: 'unavailable', recordingConsent: consent, recordingError: 'Recording is turned off (RECORDING=false)' });
      return RecordingsService.summary(call);
    }
    const d = call.startedAt ?? new Date();
    const key = `calls/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${call.id}.ogg`;
    try {
      const info = await this.egress.startRoomCompositeEgress(
        call.room,
        new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath: key }),
        { audioOnly: true },
      );
      await call.update({
        recordingStatus: 'recording', recordingConsent: consent, egressId: info.egressId, recordingKey: key,
        recordingStartedAt: new Date(), recordingError: null,
      });
      this.log.log(`recording call ${call.id} (egress ${info.egressId})`);
    } catch (e) {
      const msg = (e as Error).message;
      // Typically "no response from servers": the recording profile (egress) isn't running.
      const error = /no response|not available|unavailable|timeout|aborted/i.test(msg)
        ? 'Recorder not running (start it with make up-rec)'
        : `Could not start recording: ${msg}`;
      await call.update({ recordingStatus: 'unavailable', recordingConsent: consent, recordingError: error });
      this.log.warn(`recording call ${call.id} failed to start: ${msg}`);
    }
    return RecordingsService.summary(call);
  }

  /** Stop recording. With `discard` (caller declined) the file is deleted once egress has uploaded it. */
  async stop(id: string, discard: boolean) {
    const call = await this.find(id);
    if (call.egressId && call.recordingStatus === 'recording') {
      await this.egress.stopEgress(call.egressId).catch(() => undefined); // may have ended already
    }
    if (discard) {
      if (call.recordingStatus === 'ready') await this.deleteObject(call);
      await call.update({ recordingStatus: 'declined', recordingDurationMs: null, recordingBytes: null });
    } else if (call.recordingStatus === 'recording') {
      await call.update({ recordingStatus: 'processing' });
    }
    return RecordingsService.summary(call);
  }

  /** Called when a call ends: stop its egress now instead of waiting for the room to close. */
  async finish(call: Call) {
    if (call.recordingStatus === 'recording') await this.stop(call.id, false).catch(() => undefined);
  }

  /** Owner deletes a recording by hand. */
  async remove(id: string) {
    const call = await this.find(id);
    if (call.recordingStatus === 'recording') await this.stop(id, false);
    await this.deleteObject(call);
    await call.update({ recordingStatus: 'deleted', recordingKey: null, recordingBytes: null, egressId: null });
    return RecordingsService.summary(call);
  }

  async stream(id: string, range?: string) {
    const call = await this.find(id);
    if (call.recordingStatus !== 'ready' || !call.recordingKey) throw new NotFoundException('no recording for this call');
    const r = await this.s3.send(new GetObjectCommand({
      Bucket: config.recordings.bucket, Key: call.recordingKey, ...(range ? { Range: range } : {}),
    }));
    return {
      body: r.Body as NodeJS.ReadableStream,
      partial: Boolean(range && r.ContentRange),
      headers: {
        'content-type': 'audio/ogg',
        'accept-ranges': 'bytes',
        ...(r.ContentLength != null ? { 'content-length': String(r.ContentLength) } : {}),
        ...(r.ContentRange ? { 'content-range': r.ContentRange } : {}),
        'cache-control': 'private, no-store',
      },
    };
  }

  private async deleteObject(call: Call) {
    if (!call.recordingKey) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: config.recordings.bucket, Key: call.recordingKey }))
      .catch((e) => this.log.warn(`could not delete ${call.recordingKey}: ${(e as Error).message}`));
  }

  /** Follow open egress jobs until the file is uploaded (or failed), then settle the call row. */
  async reconcile() {
    if (this.busy) return;
    this.busy = true;
    try {
      const open = await this.calls.findAll({
        where: { recordingStatus: { [Op.in]: [...OPEN] }, egressId: { [Op.ne]: null } }, limit: 50,
      });
      for (const call of open) await this.settle(call).catch((e) => this.log.warn(`reconcile ${call.id}: ${(e as Error).message}`));
    } finally {
      this.busy = false;
    }
  }

  private async settle(call: Call) {
    const [info] = await this.egress.listEgress({ egressId: call.egressId! });
    const declined = call.recordingStatus === 'declined';
    if (!info) {
      if (Date.now() - (call.recordingStartedAt?.getTime() ?? 0) > 10 * 60_000) {
        await call.update(declined
          ? { egressId: null }
          : { recordingStatus: 'failed', recordingError: 'Recorder lost track of this recording', egressId: null });
      }
      return;
    }
    switch (info.status) {
      case EgressStatus.EGRESS_COMPLETE:
      case EgressStatus.EGRESS_LIMIT_REACHED: {
        if (declined) {
          await this.deleteObject(call);
          await call.update({ egressId: null, recordingKey: null });
          return;
        }
        const file = info.fileResults[0];
        await call.update({
          recordingStatus: 'ready',
          recordingDurationMs: file ? Math.round(Number(file.duration) / 1e6) : null,
          recordingBytes: file ? String(file.size) : null,
          egressId: null,
        });
        this.log.log(`recording ready for call ${call.id}`);
        return;
      }
      case EgressStatus.EGRESS_FAILED:
      case EgressStatus.EGRESS_ABORTED:
        if (declined) await this.deleteObject(call);
        await call.update(declined
          ? { egressId: null, recordingKey: null }
          : { recordingStatus: 'failed', recordingError: info.error || 'Recording failed', egressId: null });
        return;
      default:
        // Still running: stop it if the call has been over for a while (room left open).
        if (call.status === 'ended' && call.endedAt && Date.now() - call.endedAt.getTime() > 30_000) {
          await this.egress.stopEgress(call.egressId!).catch(() => undefined);
          if (call.recordingStatus === 'recording') await call.update({ recordingStatus: 'processing' });
        }
    }
  }

  /** Apply org retention: delete old recording files and blank old transcript text. */
  async prune() {
    try {
      const profile = await this.profiles.findByPk(1);
      const recDays = profile?.recordingRetentionDays;
      const txDays = profile?.transcriptRetentionDays;
      if (recDays) {
        const cutoff = new Date(Date.now() - recDays * 86_400_000);
        const old = await this.calls.findAll({ where: { recordingStatus: 'ready', startedAt: { [Op.lt]: cutoff } }, limit: 500 });
        for (const call of old) {
          await this.deleteObject(call);
          await call.update({ recordingStatus: 'expired', recordingKey: null });
        }
        if (old.length) this.log.log(`retention: removed ${old.length} recording(s) older than ${recDays} days`);
      }
      if (txDays) {
        const cutoff = new Date(Date.now() - txDays * 86_400_000);
        const [, n] = await this.sequelize.query(
          `WITH old AS (
             UPDATE calls SET transcript_purged_at = now()
             WHERE transcript_purged_at IS NULL AND started_at < :cutoff
             RETURNING id)
           UPDATE call_turns SET user_text = NULL, agent_text = NULL WHERE call_id IN (SELECT id FROM old)`,
          { replacements: { cutoff } },
        );
        const count = typeof n === 'number' ? n : (n as { rowCount?: number })?.rowCount ?? 0;
        if (count) this.log.log(`retention: cleared transcript text of ${count} turn(s) older than ${txDays} days`);
      }
    } catch (e) {
      this.log.warn(`retention run failed: ${(e as Error).message}`);
    }
  }
}
