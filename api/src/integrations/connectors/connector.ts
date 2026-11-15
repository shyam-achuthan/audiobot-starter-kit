import { Lead, OutboxEvent, Ticket } from '../../database/models';
import type { Connector as ConnectorName } from '../../database/models';

/** Error from a connected system; `status` is the HTTP status when there was one. */
export class ConnectorError extends Error {
  constructor(message: string, readonly status?: number, readonly response?: string) {
    super(message);
  }
}

export interface ConnectorStatus {
  name: ConnectorName;
  label: string;
  configured: boolean;
  /** Result of a live check against the system (only when configured). */
  reachable?: boolean;
  detail?: string;
  /** Where admins open the app in a browser. */
  appUrl?: string;
  missing?: string[];
}

/** A built-in integration that mirrors our records into another system. */
export interface Connector {
  readonly name: ConnectorName;
  readonly label: string;
  configured(): boolean;
  /** Event types this connector syncs. */
  handles(type: string): boolean;
  /** Sync the current state of the event's subject. Returns a short summary for the delivery log. */
  sync(event: OutboxEvent): Promise<string>;
  status(): Promise<ConnectorStatus>;
  /** Browser link to the record this lead/ticket created, if any. */
  recordUrl(record: Lead | Ticket): string | null;
}

/** Small fetch wrapper: JSON in/out, timeout, and a ConnectorError on non-2xx. */
export async function http<T = any>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
  } catch (e) {
    throw new ConnectorError(`${init.method ?? 'GET'} ${new URL(url).pathname}: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ConnectorError(
      `${init.method ?? 'GET'} ${new URL(url).pathname} returned ${res.status}: ${text.slice(0, 300)}`,
      res.status, text.slice(0, 2000),
    );
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return text as unknown as T;
  }
}

/** "lead:<uuid>" -> "<uuid>" */
export function subjectId(event: OutboxEvent): string {
  return event.subject.split(':')[1] ?? '';
}
