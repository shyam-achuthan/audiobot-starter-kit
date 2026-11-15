import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, type ScryptOptions } from 'node:crypto';

// scrypt from node:crypto: no native deps. Format: scrypt$N$r$p$salt$hash (base64url).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Opaque session token handed to the browser (cookie); only its SHA-256 is stored. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const PASSWORD_MIN = 10;

/** Basic strength rule: length plus not entirely one character class. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (/^[a-z]+$/i.test(password) || /^\d+$/.test(password)) return 'password must mix letters with numbers or symbols';
  return null;
}
