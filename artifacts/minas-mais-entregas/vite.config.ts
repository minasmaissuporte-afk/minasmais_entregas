import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const versionPwaCache = {
  name: 'version-pwa-cache',
  apply: 'build' as const,
  async closeBundle() {
    const outputDirectory = path.resolve(import.meta.dirname, 'dist/public');
    const assetsDirectory = path.join(outputDirectory, 'assets');
    const assetNames = (await readdir(assetsDirectory))
      .filter((name) => /\.(?:m?js|css)$/.test(name))
      .sort();
    const serviceWorkerPath = path.join(outputDirectory, 'sw.js');
    const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
    const marker = /const CACHE_NAME = "minas-mais-static-[^"]+";/;
    if (!marker.test(serviceWorker)) {
      throw new Error('Could not version the PWA service worker cache.');
    }
    const version = createHash('sha256')
      .update(assetNames.join('\n'))
      .update(serviceWorker)
      .digest('hex')
      .slice(0, 12);
    const versionedWorker = serviceWorker.replace(
      marker,
      `const CACHE_NAME = "minas-mais-static-${version}";`,
    );
    await writeFile(serviceWorkerPath, versionedWorker);
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    versionPwaCache,
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
