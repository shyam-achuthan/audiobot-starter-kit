'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Notice, Select, Table, adminApi, fmtDate, jsonInit } from '../_ui';

type User = { id: string; email: string; name: string | null; role: string; disabled: boolean; lastLoginAt: string | null; createdAt: string };
type Me = { id: string };

export default function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'admin' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const load = () => adminApi<User[]>('/v1/admin-users').then(setUsers).catch((e) => setMsg({ tone: 'error', text: e.message }));
  useEffect(() => {
    void load();
    adminApi<Me>('/v1/auth/me').then(setMe).catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  const patch = (u: User, body: Record<string, unknown>, ok: string) =>
    run(() => adminApi(`/v1/admin-users/${u.id}`, jsonInit('PATCH', body)), ok);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-zinc-500">People who can sign in to Admin. Owners can also manage users; admins can do everything else.</p>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Table head={['User', 'Role', 'Last sign-in', 'Status', '']}>
        {users?.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-2.5">
              <div className="font-medium">{u.name ?? u.email}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-zinc-500">(you)</span>}</div>
              {u.name && <div className="text-xs text-zinc-500">{u.email}</div>}
            </td>
            <td className="px-4 py-2.5">
              <Select value={u.role} className="min-w-28 py-1" aria-label={`Role of ${u.email}`}
                onChange={(e) => void patch(u, { role: e.target.value }, `${u.email} is now ${e.target.value === 'owner' ? 'an owner' : 'an admin'}.`)}>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
              </Select>
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(u.lastLoginAt)}</td>
            <td className="px-4 py-2.5">{u.disabled ? <Badge tone="red">Disabled</Badge> : <Badge tone="green">Active</Badge>}</td>
            <td className="px-4 py-2.5">
              {u.id !== me?.id && (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => {
                    const pw = prompt(`New password for ${u.email} (10+ characters, letters plus numbers or symbols). They will be signed out everywhere.`);
                    if (pw) void patch(u, { password: pw }, `Password changed for ${u.email}.`);
                  }}>Set password</Button>
                  <Button variant="ghost" onClick={() => void patch(u, { disabled: !u.disabled }, `${u.email} ${u.disabled ? 'enabled' : 'disabled'}.`)}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </Button>
                  <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => {
                    if (confirm(`Delete ${u.email}? This cannot be undone.`)) {
                      void run(() => adminApi(`/v1/admin-users/${u.id}`, { method: 'DELETE' }), `${u.email} deleted.`);
                    }
                  }}>Delete</Button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <Card title="Add a user">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await adminApi('/v1/admin-users', jsonInit('POST', { ...form, name: form.name || undefined }));
            setForm({ email: '', name: '', password: '', role: 'admin' });
          }, `Added ${form.email}. Share the password with them securely; they can change it under their account.`);
        }}>
          <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Name (optional)"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Temporary password" hint="10+ characters, letters plus numbers or symbols.">
            <Input type="password" required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="owner">Owner (can manage users)</option>
            </Select>
          </Field>
          <div className="md:col-span-2"><Button type="submit">Add user</Button></div>
        </form>
      </Card>
    </div>
  );
}
