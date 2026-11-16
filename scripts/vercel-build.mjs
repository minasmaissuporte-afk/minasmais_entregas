/**
 * Build da Vercel (Build Output API v3): um deploy com o painel e a API juntos.
 *
 *   .vercel/output/static/              ← painel (Vite)
 *   .vercel/output/functions/api.func/  ← API Express empacotada numa função Node
 *   .vercel/output/config.json          ← /api/* vai para a função; o resto é o painel (SPA)
 *
 * Uso: node scripts/vercel-build.mjs  (a Vercel roda isso como Build Command)
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vercel", "output");
const functionDir = path.join(output, "functions", "api.func");
const run = (command, env = {}) =>
  execSync(command, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

rmSync(output, { recursive: true, force: true });

// 1. Painel. As variáveis VITE_* do projeto na Vercel entram aqui, na compilação.
run("pnpm --filter @workspace/minas-mais-entregas run build", { BASE_PATH: "/" });
cpSync(path.join(root, "artifacts", "minas-mais-entregas", "dist", "public"), path.join(output, "static"), {
  recursive: true,
});

// 2. API: o mesmo esbuild do servidor local, com a entrada da Vercel.
run("pnpm --filter @workspace/api-server run build", {
  API_BUILD_ENTRY: "src/vercel.ts",
  API_BUILD_OUTDIR: functionDir,
});
writeFileSync(
  path.join(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "vercel.mjs",
      launcherType: "Nodejs",
      // O Express lê o corpo da requisição sozinho.
      shouldAddHelpers: false,
      maxDuration: 30,
    },
    null,
    2,
  ),
);
writeFileSync(path.join(functionDir, "package.json"), JSON.stringify({ type: "module" }));

// 3. Rotas.
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(output, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api(?:/.*)?$", dest: "/api" },
        {
          src: "^/assets/(.*)$",
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        // O Service Worker precisa ser revalidado sempre, senão o PWA não atualiza.
        { src: "^/(sw\\.js|service-worker\\.js|manifest\\.webmanifest)$", headers: { "Cache-Control": "no-cache" }, continue: true },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log("Build da Vercel pronto em .vercel/output");
