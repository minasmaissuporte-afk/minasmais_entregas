import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { authDir } from "./env.ts";
import { users, type RoleKey } from "./fixtures-data.ts";

/**
 * Logins de teste no Supabase Auth (projeto de teste).
 * Criados pela API administrativa com e-mail já confirmado (nenhum e-mail é enviado).
 * As senhas ficam só em e2e/.auth/credentials.json (fora do git).
 */
const baseUrl = () => (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const secretKey = () => process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey = () =>
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

function adminHeaders(): Record<string, string> {
  const key = secretKey();
  return key.startsWith("sb_secret_")
    ? { apikey: key, "Content-Type": "application/json" }
    : { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function admin(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl()}/auth/v1/admin${path}`, { ...init, headers: { ...adminHeaders(), ...(init.headers ?? {}) } });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase admin ${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function findUserByEmail(email: string): Promise<{ id: string } | undefined> {
  for (let page = 1; page <= 20; page += 1) {
    const res = await admin(`/users?page=${page}&per_page=200`);
    const body = await res.json();
    const list: { id: string; email?: string }[] = body.users ?? [];
    const found = list.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (list.length < 200) return undefined;
  }
  return undefined;
}

export type Credentials = Record<RoleKey, { id: string; email: string; password: string }>;
const credentialsFile = () => resolve(authDir, "credentials.json");

export function credentials(): Credentials {
  return JSON.parse(readFileSync(credentialsFile(), "utf8"));
}

/** Garante os logins de teste com uma senha nova a cada execução. */
export async function ensureAuthUsers(): Promise<Credentials> {
  mkdirSync(authDir, { recursive: true });
  const result = {} as Credentials;
  for (const [key, user] of Object.entries(users) as [RoleKey, (typeof users)[RoleKey]][]) {
    const password = `E2e!${randomBytes(12).toString("base64url")}`;
    const existing = await findUserByEmail(user.email);
    let id: string;
    if (existing) {
      await admin(`/users/${existing.id}`, { method: "PUT", body: JSON.stringify({ password, email_confirm: true }) });
      id = existing.id;
    } else {
      const res = await admin("/users", {
        method: "POST",
        body: JSON.stringify({ email: user.email, password, email_confirm: true, user_metadata: { full_name: user.name } }),
      });
      id = (await res.json()).id;
    }
    result[key] = { id, email: user.email, password };
  }
  writeFileSync(credentialsFile(), JSON.stringify(result, null, 2));
  return result;
}

export async function deleteAuthUsers() {
  for (const user of Object.values(users)) {
    const found = await findUserByEmail(user.email);
    if (found) await admin(`/users/${found.id}`, { method: "DELETE" });
  }
}

const tokenCache = new Map<RoleKey, { jwt: string; expiresAt: number }>();

/** Access token (JWT) do Supabase para chamar a API como o papel. */
export async function accessToken(role: RoleKey): Promise<string> {
  const cached = tokenCache.get(role);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.jwt;
  if (!existsSync(credentialsFile())) throw new Error("Rode o global-setup antes (credenciais E2E ausentes).");
  const { email, password } = credentials()[role];
  const res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login Supabase de ${role} falhou: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  tokenCache.set(role, { jwt: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}
