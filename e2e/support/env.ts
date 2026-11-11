import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const authDir = resolve(here, "..", ".auth");

/** Carrega o .env da raiz sem sobrescrever variáveis já definidas. */
export function loadEnv() {
  const file = resolve(repoRoot, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnv();

export const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
export const WEB_URL = process.env.E2E_WEB_URL ?? `http://localhost:${process.env.WEB_PORT ?? 5173}`;

export function assertSafeEnvironment() {
  const db = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
    throw new Error("E2E recusado: DATABASE_URL não aponta para um Postgres local.");
  }
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("E2E: configure SUPABASE_URL e SUPABASE_SECRET_KEY (projeto Supabase de teste) no .env.");
  }
}
