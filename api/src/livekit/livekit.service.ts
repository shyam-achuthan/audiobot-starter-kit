import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config, Workflow } from '../config';

@Injectable()
export class LivekitService {
  private readonly rooms = new RoomServiceClient(
    config.livekit.url.replace(/^ws/, 'http'),
    config.livekit.apiKey,
    config.livekit.apiSecret,
  );

  /** Issues a short-lived token for a browser/widget visitor to join a fresh room. */
  async createWebSession(opts: { workflow: Workflow; name?: string; metadata?: Record<string, unknown> }) {
    const room = `web-${randomUUID()}`;
    const identity = `visitor-${randomUUID().slice(0, 8)}`;

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity,
      name: opts.name ?? 'Website visitor',
      ttl: '15m',
      // The agent reads this to pick the starting workflow.
      metadata: JSON.stringify({ ...opts.metadata, workflow: opts.workflow, channel: 'web' }),
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return {
      url: config.livekit.publicUrl,
      token: await at.toJwt(),
      room,
      identity,
      workflow: opts.workflow,
    };
  }

  async ping(): Promise<{ ok: boolean; rooms?: number; error?: string }> {
    try {
      const rooms = await this.rooms.listRooms();
      return { ok: true, rooms: rooms.length };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
