'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

/** Loads the widget exactly as a customer site would (Admin -> Widgets -> Preview). */
function Preview() {
  const key = useSearchParams().get('key') ?? '';
  useEffect(() => {
    if (!key || document.getElementById('audiobots-widget-script')) return;
    const s = document.createElement('script');
    s.id = 'audiobots-widget-script';
    s.src = '/widget.js';
    s.async = true;
    s.dataset.key = key;
    s.dataset.open = 'true';
    document.body.appendChild(s);
  }, [key]);
  return (
    <div className="mx-auto max-w-2xl space-y-3 py-10">
      <h1 className="text-2xl font-semibold">Widget preview</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This page loads the widget the same way your website will. The voice button is in the bottom corner.
        Allow the microphone when your browser asks.
      </p>
      {!key && <p className="text-sm text-red-700">Missing ?key= — open this from Admin → Widgets.</p>}
    </div>
  );
}

export default function WidgetPreviewPage() {
  return <Suspense><Preview /></Suspense>;
}
