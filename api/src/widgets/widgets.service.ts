import {
  ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import { config, Workflow } from '../config';
import { Call, Widget, WidgetAppearance } from '../database/models';
import { LivekitService } from '../livekit/livekit.service';

const WINDOW_MS = 10 * 60_000;
const IP_LIMIT = Number(process.env.WIDGET_IP_LIMIT ?? 6); // calls per visitor IP per 10 min
const WIDGET_LIMIT = Number(process.env.WIDGET_RATE_LIMIT ?? 60); // calls per widget per 10 min
const PENDING_MS = 90_000; // a token was issued but the call row may not exist yet

export const APPEARANCE_DEFAULTS: Required<WidgetAppearance> = {
  title: 'Talk to us', buttonLabel: 'Talk to us', color: '#18181b', position: 'right', captions: true,
};

class TooMany extends HttpException {
  constructor(reason: 'rate_limited' | 'busy', message: string, retryAfter?: number) {
    super({ statusCode: 429, reason, message, retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** "https://Shop.Example.com:443/" -> "https://shop.example.com" (scheme://host[:port], default ports dropped). */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.includes('://') ? value : `https://${value}`);
    return u.origin === 'null' ? null : u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Allowed-origin patterns: "https://shop.example.com", "https://*.example.com", "*.example.com" (https). */
export function originMatches(origin: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/\/+$/, '');
  if (!p) return false;
  const wild = p.match(/^(?:(https?):\/\/)?\*\.(.+)$/);
  if (wild) {
    const scheme = wild[1] ?? 'https';
    const rest = wild[2];
    try {
      const u = new URL(origin);
      return u.protocol === `${scheme}:` && (u.host.endsWith(`.${rest}`));
    } catch {
      return false;
    }
  }
  return normalizeOrigin(p) === origin;
}

/**
 * Website widgets: public keys, allowed origins, look, and the abuse limits on the public
 * session endpoint (per-IP and per-widget rate limits, concurrent-call cap).
 */
@Injectable()
export class WidgetsService {
  private readonly hits = new Map<string, number[]>();
  private readonly pending = new Map<string, number[]>();

  constructor(
    @InjectModel(Widget) private readonly widgets: typeof Widget,
    @InjectModel(Call) private readonly calls: typeof Call,
    private readonly livekit: LivekitService,
  ) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  /** Our own dashboard/demo origins (always allowed, e.g. for the widget preview). */
  firstPartyOrigins(): string[] {
    return [...config.corsOrigins, config.publicWebUrl].map((o) => normalizeOrigin(o)).filter((o): o is string => Boolean(o));
  }

  /** Our own pages: a first-party origin, or the same host the request came in on (LAN address). */
  isFirstParty(origin: string | null, forwardedHost?: string) {
    if (!origin) return false;
    return this.firstPartyOrigins().includes(origin)
      || Boolean(forwardedHost && new URL(origin).host === forwardedHost.toLowerCase());
  }

  originAllowed(w: Widget, origin: string | undefined, forwardedHost?: string): boolean {
    const o = origin ? normalizeOrigin(origin) : null;
    if (!o) return false;
    return this.isFirstParty(o, forwardedHost) || w.allowedOrigins.some((p) => originMatches(o, p));
  }

  private bump(key: string, limit: number, map = this.hits): number | null {
    const now = Date.now();
    const list = (map.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length >= limit) {
      map.set(key, list);
      return Math.ceil((WINDOW_MS - (now - list[0])) / 1000); // seconds until a slot frees up
    }
    list.push(now);
    map.set(key, list);
    return null;
  }

  private sweep() {
    const now = Date.now();
    for (const [map, ttl] of [[this.hits, WINDOW_MS], [this.pending, PENDING_MS]] as const) {
      for (const [k, v] of map) {
        const kept = v.filter((t) => now - t < ttl);
        if (kept.length) map.set(k, kept); else map.delete(k);
      }
    }
  }

  /** Rate limit for first-party token requests (demo page) without a server token. */
  limitIp(ip: string) {
    const wait = this.bump(`ip:${ip}`, IP_LIMIT);
    if (wait) throw new TooMany('rate_limited', 'Too many calls from this network. Try again in a few minutes.', wait);
  }

  private async find(key: string, origin: string | undefined, forwardedHost?: string) {
    const w = key ? await this.widgets.findOne({ where: { publicKey: key } }) : null;
    if (!w || !w.enabled) throw new NotFoundException('This widget is not available');
    if (!this.originAllowed(w, origin, forwardedHost)) throw new ForbiddenException('This website is not allowed to use this widget');
    return w;
  }

  publicConfig(w: Widget) {
    return {
      name: w.name,
      ...APPEARANCE_DEFAULTS,
      ...Object.fromEntries(Object.entries(w.appearance ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '')),
      maxMinutes: w.maxMinutes,
    };
  }

  async config(key: string, origin: string | undefined, forwardedHost?: string) {
    return this.publicConfig(await this.find(key, origin, forwardedHost));
  }

  /** Start a call from a widget: checks origin, rate limits and the concurrent-call cap. */
  async session(key: string, origin: string | undefined, ip: string, forwardedHost?: string) {
    const w = await this.find(key, origin, forwardedHost);
    const ipWait = this.bump(`ip:${ip}`, IP_LIMIT);
    if (ipWait) throw new TooMany('rate_limited', 'Too many calls from this network. Try again in a few minutes.', ipWait);
    const widgetWait = this.bump(`widget:${w.id}`, WIDGET_LIMIT);
    if (widgetWait) throw new TooMany('rate_limited', 'This widget is getting too many calls. Try again shortly.', widgetWait);

    const live = await this.calls.count({
      where: {
        widgetId: w.id, status: 'active',
        startedAt: { [Op.gt]: new Date(Date.now() - (w.maxMinutes + 5) * 60_000) },
      },
    });
    const now = Date.now();
    const pending = (this.pending.get(w.id) ?? []).filter((t) => now - t < PENDING_MS);
    if (live + pending.length >= w.maxConcurrent) {
      throw new TooMany('busy', 'All our assistants are busy right now. Please try again in a minute.', 60);
    }
    pending.push(now);
    this.pending.set(w.id, pending);

    const session = await this.livekit.createWebSession({
      workflow: w.workflow as Workflow,
      metadata: { widgetId: w.id, maxMinutes: w.maxMinutes, origin: normalizeOrigin(origin!) },
    });
    return { url: session.url, token: session.token, room: session.room, maxMinutes: w.maxMinutes };
  }

  // ---------------------------------------------------------------- admin

  list() {
    return this.widgets.findAll({ order: [['createdAt', 'ASC']] });
  }

  async get(id: string) {
    const w = await this.widgets.findByPk(id);
    if (!w) throw new NotFoundException('widget not found');
    return w;
  }

  private clean(dto: Partial<WidgetInput>): Partial<Widget> {
    const out: Partial<Widget> = {};
    if (dto.name !== undefined) out.name = dto.name.trim() || 'Website widget';
    if (dto.allowedOrigins !== undefined) {
      const bad = dto.allowedOrigins.filter((p) => !/^(?:(https?):\/\/)?\*\.[a-z0-9.-]+$/i.test(p.trim()) && !normalizeOrigin(p));
      if (bad.length) throw new HttpException(`Not a website origin: ${bad.join(', ')}`, HttpStatus.BAD_REQUEST);
      out.allowedOrigins = [...new Set(dto.allowedOrigins.map((p) => p.trim()).filter(Boolean)
        .map((p) => (p.includes('*') ? p.toLowerCase().replace(/\/+$/, '') : normalizeOrigin(p)!)))];
    }
    if (dto.workflow !== undefined) out.workflow = dto.workflow;
    if (dto.appearance !== undefined) out.appearance = dto.appearance;
    if (dto.maxConcurrent !== undefined) out.maxConcurrent = dto.maxConcurrent;
    if (dto.maxMinutes !== undefined) out.maxMinutes = dto.maxMinutes;
    if (dto.enabled !== undefined) out.enabled = dto.enabled;
    return out;
  }

  create(dto: WidgetInput) {
    return this.widgets.create({ ...this.clean(dto), publicKey: `wk_${randomBytes(18).toString('base64url')}` });
  }

  async update(id: string, dto: Partial<WidgetInput>) {
    return (await this.get(id)).update(this.clean(dto));
  }

  async rotateKey(id: string) {
    return (await this.get(id)).update({ publicKey: `wk_${randomBytes(18).toString('base64url')}` });
  }

  async remove(id: string) {
    await (await this.get(id)).destroy();
    return { deleted: true };
  }
}

export type WidgetInput = {
  name: string; allowedOrigins: string[]; workflow: string; appearance: WidgetAppearance;
  maxConcurrent: number; maxMinutes: number; enabled: boolean;
};
