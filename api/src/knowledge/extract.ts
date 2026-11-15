import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { convert } from 'html-to-text';
import mammoth from 'mammoth';

// unpdf is ESM-only; this keeps a real dynamic import after CommonJS compilation.
const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>;

// The two unpdf functions we use (its ESM-only types don't resolve under CommonJS).
interface Unpdf {
  getDocumentProxy(data: Uint8Array): Promise<unknown>;
  extractText(pdf: unknown, opts: { mergePages: false }): Promise<{ totalPages: number; text: string[] }>;
}

export const SUPPORTED_FILE_TYPES = ['.pdf', '.docx', '.txt', '.md', '.markdown'] as const;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface Extracted {
  title: string;
  text: string;
}

function clean(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export async function extractFile(filename: string, buf: Buffer): Promise<Extracted> {
  const e = ext(filename);
  const title = filename.replace(/\.[^.]+$/, '');
  let text: string;
  if (e === '.pdf') {
    const { extractText, getDocumentProxy } = await importEsm<Unpdf>('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await extractText(pdf, { mergePages: false });
    text = out.text.join('\n\n');
  } else if (e === '.docx') {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (e === '.txt' || e === '.md' || e === '.markdown') {
    text = buf.toString('utf8');
  } else {
    throw new BadRequestException(
      `Unsupported file type "${e || filename}". Use: ${SUPPORTED_FILE_TYPES.join(', ')}`,
    );
  }
  text = clean(text);
  if (!text) throw new BadRequestException(`No readable text found in ${filename} (scanned PDFs need OCR).`);
  return { title, text };
}

// ---------------------------------------------------------------- URLs

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Only public http(s) URLs: blocks localhost, Docker-internal and private network addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Enter a full URL starting with https://');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new BadRequestException('Only http(s) URLs are allowed');
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new BadRequestException(`Could not resolve ${url.hostname}`);
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new BadRequestException('Private, local or internal addresses are not allowed');
  }
  return url;
}

async function fetchText(url: URL, maxBytes = 5 * 1024 * 1024): Promise<{ body: string; type: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'AudioBotsKnowledgeIndexer/1.0', accept: 'text/html,application/xml,text/plain' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // Re-check the final URL after redirects.
  await assertPublicUrl(res.url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`Page is larger than ${maxBytes / 1024 / 1024} MB`);
  return { body: buf.toString('utf8'), type: res.headers.get('content-type') ?? '' };
}

export function isSitemap(url: URL, body?: string): boolean {
  return /sitemap[^/]*\.xml$/i.test(url.pathname) || (!!body && /<(urlset|sitemapindex)[\s>]/i.test(body));
}

/** Page URLs listed in a sitemap (follows one level of sitemap index). */
export async function sitemapUrls(url: URL, limit: number): Promise<string[]> {
  const { body } = await fetchText(url);
  const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  if (/<sitemapindex[\s>]/i.test(body)) {
    const pages: string[] = [];
    for (const child of locs) {
      if (pages.length >= limit) break;
      try {
        pages.push(...(await sitemapUrls(await assertPublicUrl(child), limit - pages.length)));
      } catch {
        /* skip broken child sitemaps */
      }
    }
    return pages.slice(0, limit);
  }
  return locs.slice(0, limit);
}

export async function extractUrl(raw: string): Promise<Extracted> {
  const url = await assertPublicUrl(raw);
  const { body, type } = await fetchText(url);
  if (!/html|text\/plain/.test(type) && !/<html/i.test(body)) {
    throw new Error(`Unsupported content type ${type || 'unknown'}`);
  }
  const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
  const text = clean(
    convert(body, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'nav', format: 'skip' },
        { selector: 'footer', format: 'skip' },
        { selector: 'header', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'form', format: 'skip' },
      ],
    }),
  );
  if (text.length < 50) throw new Error('Page has too little readable text (it may need JavaScript to render)');
  return { title: (titleMatch?.[1] ?? url.hostname + url.pathname).trim().slice(0, 200), text };
}
