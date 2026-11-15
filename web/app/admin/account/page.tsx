'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Notice, adminApi, jsonInit } from '../_ui';

type Me = { email: string; name: string | null; role: string };

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => { adminApi<Me>('/v1/auth/me').then(setMe).catch(() => undefined); }, []);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw.newPassword !== pw.confirm) {
      setMsg({ tone: 'error', text: 'The two new passwords do not match.' });
      return;
    }
    try {
      await adminApi('/v1/auth/password', jsonInit('POST', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }));
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setMsg({ tone: 'success', text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setMsg({ tone: 'error', text: (err as Error).message });
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        {me && <p className="text-sm text-zinc-500">{me.email} · {me.role === 'owner' ? 'Owner' : 'Admin'}</p>}
      </div>
      <Card title="Change password">
        <form onSubmit={(e) => void change(e)} className="space-y-4">
          <Field label="Current password">
            <Input type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" hint="10+ characters, letters plus numbers or symbols.">
            <Input type="password" required autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" required autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button type="submit">Change password</Button>
        </form>
      </Card>
    </div>
  );
}
