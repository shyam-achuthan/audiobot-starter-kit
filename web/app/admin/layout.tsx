import Link from 'next/link';

// Read ADMIN_PASSWORD at request time (not baked in at build).
export const dynamic = 'force-dynamic';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/setup', label: 'Setup' },
  { href: '/admin/knowledge', label: 'Knowledge' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const open = !process.env.ADMIN_PASSWORD;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="rounded-md px-3 py-1.5 hover:bg-white dark:hover:bg-zinc-800">
              {t.label}
            </Link>
          ))}
        </nav>
        {open && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            Admin is open (no ADMIN_PASSWORD set). Fine locally; set one before exposing this server.
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
