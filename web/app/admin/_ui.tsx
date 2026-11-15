'use client';

// Small UI kit for the admin pages (Tailwind only).
import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import type * as React from 'react';

export async function adminApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/admin-api${path}`, { cache: 'no-store', ...init });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message ?? `Request failed (${res.status})`;
    throw new Error(Array.isArray(msg) ? msg.join('; ') : msg);
  }
  return data as T;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function Card({ title, actions, children, className = '' }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const styles = {
    primary: 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200',
    secondary: 'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
    danger: 'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950',
    ghost: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

const control =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} min-h-24 ${props.className ?? ''}`} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
    blue: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones}`}>{children}</span>;
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'error' | 'success'; children: ReactNode }) {
  const tones = {
    neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  }[tone];
  return <div className={`rounded-md border px-3 py-2 text-sm ${tones}`}>{children}</div>;
}

export const AGENT_LABELS: Record<string, string> = {
  router: 'Receptionist',
  lead_qualification: 'Lead qualification',
  sales: 'Sales',
  support: 'Support',
};

// ---------- dashboard helpers ----------

export function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${className}`} />;
}

const IST = 'Asia/Kolkata';

export function fmtDate(v: string | Date | null | undefined, withTime = true) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', {
    timeZone: IST, day: 'numeric', month: 'short', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function fmtDuration(start: string, end: string | null) {
  if (!end) return '—';
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export const LANGUAGE_LABELS: Record<string, string> = {
  'en-IN': 'English', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', 'kn-IN': 'Kannada', 'ml-IN': 'Malayalam',
};

export const OUTCOME_LABELS: Record<string, string> = {
  lead_captured: 'Lead captured', ticket_created: 'Ticket created', callback_requested: 'Callback requested',
  info_only: 'Info only', abandoned: 'Abandoned', transferred: 'Transferred to a person', in_progress: 'In progress', unknown: 'Unknown',
};

export function outcomeTone(o: string | null): 'green' | 'blue' | 'amber' | 'neutral' {
  if (o === 'lead_captured' || o === 'callback_requested' || o === 'transferred') return 'green';
  if (o === 'ticket_created') return 'blue';
  if (o === 'abandoned') return 'amber';
  return 'neutral';
}

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed',
};
export const PRIORITY_TONES: Record<string, 'red' | 'amber' | 'neutral' | 'blue'> = {
  urgent: 'red', high: 'amber', normal: 'neutral', low: 'blue',
};
export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New', qualified: 'Qualified', unqualified: 'Unqualified', callback: 'Callback',
};

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Pager({ offset, limit, total, onChange }: {
  offset: number; limit: number; total: number; onChange: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) return <p className="text-xs text-zinc-500">{total} total</p>;
  return (
    <div className="flex items-center justify-between text-sm text-zinc-500">
      <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="secondary" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

/** Paged list from the API, refetched when the query changes. */
export function useList<T>(path: string, query: Record<string, string | number | undefined>) {
  const [data, setData] = useState<{ items: T[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    adminApi<{ items: T[]; total: number }>(`${path}?${qs}`)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [path, qs, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1) };
}

/** Debounced value for search boxes. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-zinc-500">{text}</p>;
}

export type CrmLink = { name: string; label: string; url: string };

/** "Open in Twenty CRM" / "Open in Chatwoot" links for a synced lead or ticket. */
export function CrmLinks({ links }: { links?: CrmLink[] }) {
  if (!links?.length) return null;
  return (
    <>
      {links.map((l) => (
        <span key={l.name}> · <a href={l.url} target="_blank" rel="noreferrer" className="underline">open in {l.label}</a></span>
      ))}
    </>
  );
}
