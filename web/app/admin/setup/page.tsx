'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Notice, Textarea, adminApi, jsonInit } from '../_ui';

type Profile = {
  companyName: string;
  description: string | null;
  industry: string | null;
  website: string | null;
  supportHours: string | null;
  callbackHours: string | null;
  extraInstructions: string | null;
  setupCompleted: boolean;
};

type KbSummary = { id: string; name: string; documentCount: number; byStatus: Record<string, number> };

const FIELDS: { key: keyof Profile; label: string; hint?: string; placeholder?: string; long?: boolean }[] = [
  { key: 'companyName', label: 'Business name', placeholder: 'QuickBill', hint: 'Agents introduce themselves as working for this business.' },
  { key: 'description', label: 'What you offer', long: true, placeholder: 'Billing and GST invoicing software for retail shops in India…', hint: 'One or two sentences the agents use to describe the business.' },
  { key: 'industry', label: 'Industry', placeholder: 'Retail software' },
  { key: 'website', label: 'Website', placeholder: 'https://quickbill.example' },
  { key: 'supportHours', label: 'Support hours', placeholder: 'Mon–Sat, 9 AM – 8 PM IST' },
  { key: 'callbackHours', label: 'Callback hours', placeholder: 'Weekdays 10 AM – 6 PM', hint: 'When specialists return calls; agents mention this when booking callbacks.' },
  { key: 'extraInstructions', label: 'Extra instructions for the agents', long: true, placeholder: 'Always mention the 14-day free trial. Never promise delivery dates.', hint: 'Optional rules added to every agent.' },
];

export default function SetupPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [kbs, setKbs] = useState<KbSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    adminApi<Profile>('/v1/profile').then(setProfile).catch((e) => setMsg({ tone: 'error', text: e.message }));
    adminApi<KbSummary[]>('/v1/knowledge').then(setKbs).catch(() => undefined);
  }, []);

  const save = async (extra: Partial<Profile> = {}) => {
    if (!profile) return;
    setSaving(true);
    setMsg(null);
    try {
      const body = { ...profile, ...extra };
      const { setupCompleted, ...rest } = body;
      const saved = await adminApi<Profile>('/v1/profile', jsonInit('PUT', {
        ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? ''])),
        setupCompleted,
      }));
      setProfile(saved);
      setMsg({ tone: 'success', text: 'Saved. New calls use these details immediately.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const docs = kbs.reduce((a, k) => a + k.documentCount, 0);
  const ready = kbs.reduce((a, k) => a + (k.byStatus.ready ?? 0), 0);
  const steps = [
    { n: 1, title: 'Business profile', done: !!profile?.description },
    { n: 2, title: 'Knowledge', done: ready > 0 },
    { n: 3, title: 'Test a call', done: !!profile?.setupCompleted },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Product setup</h1>
        <p className="text-sm text-zinc-500">Tell the voice agents about your business, add what they should know, then try a call.</p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${s.done ? 'bg-emerald-600 text-white' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}`}>
              {s.done ? '✓' : s.n}
            </span>
            <span className="text-sm font-medium">{s.title}</span>
          </li>
        ))}
      </ol>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="1 · Business profile">
        {!profile ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {FIELDS.map((f) => (
              <div key={f.key} className={f.long ? 'md:col-span-2' : ''}>
                <Field label={f.label} hint={f.hint}>
                  {f.long ? (
                    <Textarea
                      value={(profile[f.key] as string) ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                    />
                  ) : (
                    <Input
                      value={(profile[f.key] as string) ?? ''}
                      placeholder={f.placeholder}
                      required={f.key === 'companyName'}
                      onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            ))}
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
            </div>
          </form>
        )}
      </Card>

      <Card title="2 · Knowledge" actions={<Link href="/admin/knowledge"><Button variant="secondary">Manage knowledge</Button></Link>}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload price lists, policies and guides, add FAQs, or index pages from your website. Agents answer from
          this, and quote prices and policies only when they're in here.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Badge tone={kbs.length ? 'blue' : 'neutral'}>{kbs.length} knowledge base{kbs.length === 1 ? '' : 's'}</Badge>
          <Badge tone={ready ? 'green' : 'neutral'}>{ready} of {docs} sources ready</Badge>
        </div>
      </Card>

      <Card title="3 · Test a call">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Open the demo in Chrome, allow the microphone, and ask about your products or prices in any supported language.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/demo" target="_blank"><Button variant="secondary">Open demo</Button></Link>
          <Button disabled={saving || !profile} onClick={() => void save({ setupCompleted: true })}>
            {profile?.setupCompleted ? 'Setup complete ✓' : 'Mark setup complete'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
