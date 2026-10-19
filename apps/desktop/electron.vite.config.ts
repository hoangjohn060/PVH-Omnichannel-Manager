import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { productionCsp } from './electron/security/policy';

export default defineConfig({
  main: { build: { externalizeDeps: { exclude: ['@pvh/shared'] }, rollupOptions: { input: { index: resolve('electron/main/index.ts'), 'database-worker': resolve('electron/workers/database-worker.ts'), 'zalo-worker': resolve('electron/workers/zalo-worker.ts') }, output: { format: 'cjs', entryFileNames: '[name].js' } } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { input: resolve('electron/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.js' } } } },
  renderer: { root: '.', plugins: [react(), tailwindcss(), {
    name: 'pvh-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, context) => html.replace(/content="default-src[^"]+"/, `content="${context.server ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'" : productionCsp.replace("; frame-ancestors 'none'", '')}"`),
    },
  }], server: { host: '127.0.0.1', open: false }, build: { minify: true, rollupOptions: { input: resolve('index.html') } } },
});