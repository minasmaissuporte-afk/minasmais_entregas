import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

// O .env fica na raiz do monorepo (compartilhado com a API).
const envDir = path.resolve(import.meta.dirname, '..', '..');
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', envDir, '');
const env = { ...fileEnv, ...process.env };

const rawPort = env.WEB_PORT ?? '5173';
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid WEB_PORT value: "${rawPort}"`);
}

const basePath = env.BASE_PATH || '/';

// Em desenvolvimento, /api é encaminhado para a API local (no Replit isso era feito pelo roteador da plataforma).
const apiTarget = env.API_PROXY_TARGET || `http://localhost:${env.PORT || '8080'}`;

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
    versionPwaCache,
  ],
  envDir,
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
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});
