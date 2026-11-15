'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/calls', label: 'Calls' },
  { href: '/admin/leads', label: 'Leads' },
  { href: '/admin/tickets', label: 'Tickets' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/knowledge', label: 'Knowledge' },
  { href: '/admin/setup', label: 'Setup' },
];

export function AdminNav({ owner }: { owner: boolean }) {
  const path = usePathname();
  const tabs = owner
    ? [...TABS, { href: '/admin/phone', label: 'Phone' }, { href: '/admin/integrations', label: 'Integrations' }, { href: '/admin/users', label: 'Users' }]
    : TABS;
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href));
  return (
    <nav aria-label="Admin" className="-mx-1 flex max-w-full gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t.href) ? 'page' : undefined}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 ${
            active(t.href)
              ? 'bg-white font-medium shadow-sm dark:bg-zinc-800'
              : 'text-zinc-600 hover:bg-white/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function SignOut() {
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
      onClick={async () => {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
    >
      Sign out
    </button>
  );
}
