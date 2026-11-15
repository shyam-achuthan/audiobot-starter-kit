// Builds the embeddable widget (web/public/widget.js): one self-contained IIFE script,
// livekit-client included, so a site only needs <script src=".../widget.js" data-key="wk_...">.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: here('../public'),
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
    lib: {
      entry: here('./src/index.ts'),
      name: 'AudioBotsWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
});
