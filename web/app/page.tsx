import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">AudioBots</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Voice agents for sales, support and lead qualification — on the web and over SIP.
      </p>
      <div className="flex gap-3">
        <Link href="/demo" className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-zinc-900">Open demo</Link>
        <Link href="/admin" className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Admin</Link>
      </div>
    </div>
  );
}
