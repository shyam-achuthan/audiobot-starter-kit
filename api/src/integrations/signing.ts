import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks (https://www.standardwebhooks.com) signing.
 * Secret: "whsec_" + base64(24 random bytes). Signed content: `${id}.${timestamp}.${body}`.
 */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

function key(secret: string): Buffer {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
}

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', key(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

/** Headers for one delivery attempt. The id stays the same across retries. */
export function signedHeaders(secret: string, id: string, body: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': sign(secret, id, timestamp, body),
  };
}

/** Receiver-side check (used in tests and the docs example). Tolerance is 5 minutes. */
export function verify(secret: string, headers: Record<string, string>, body: string, now = Date.now()): boolean {
  const id = headers['webhook-id'];
  const ts = Number(headers['webhook-timestamp']);
  if (!id || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = Buffer.from(sign(secret, id, ts, body).slice(3), 'base64');
  return (headers['webhook-signature'] ?? '').split(' ').some((part) => {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
