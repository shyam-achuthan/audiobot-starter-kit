'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const control =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800';

function safeNext(next: string | null) {
  // Only same-site paths inside the admin area (no open redirects).
  return next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
}

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<'loading' | 'login' | 'setup'>('loading');
  const [form, setForm] = useState({ email: '', password: '', confirm: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/backend/v1/auth/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMode(d.needsSetup ? 'setup' : 'login'))
      .catch(() => setMode('login'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'setup' && form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    const body = mode === 'setup'
      ? { email: form.email, password: form.password, name: form.name || undefined }
      : { email: form.email, password: form.password };
    const r = await fetch(mode === 'setup' ? '/auth/setup' : '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) {
      window.location.href = safeNext(params.get('next'));
      return;
    }
    const d = await r.json().catch(() => ({}));
    const msg = Array.isArray(d.message) ? d.message.join('; ') : d.message;
    setError(msg ? msg.charAt(0).toUpperCase() + msg.slice(1) : 'Sign-in failed.');
    setBusy(false);
  };

  if (mode === 'loading') return null;
  const setup = mode === 'setup';

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">{setup ? 'Create the owner account' : 'Sign in to Admin'}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {setup
            ? 'No admin accounts exist yet. The first account is the owner and can add other admins.'
            : 'Use the email and password of your admin account.'}
        </p>
        <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4">
          {setup && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Name (optional)</span>
              <input className={control} value={form.name} autoComplete="name"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Email</span>
            <input className={control} type="email" required autoFocus autoComplete="username" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Password</span>
            <input className={control} type="password" required autoComplete={setup ? 'new-password' : 'current-password'}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            {setup && <span className="block text-xs text-zinc-500">At least 10 characters, mixing letters with numbers or symbols.</span>}
          </label>
          {setup && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Confirm password</span>
              <input className={control} type="password" required autoComplete="new-password" value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </label>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
            {busy ? 'Please wait…' : setup ? 'Create account and sign in' : 'Sign in'}
          </button>
        </form>
      </div>
      {!setup && <p className="mt-4 text-center text-xs text-zinc-500">Forgot your password? Ask an owner to set a new one under Admin → Users.</p>}
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
