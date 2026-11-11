import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { API_URL, authDir } from "./env.ts";
import { accessToken } from "./auth.ts";
import type { RoleKey } from "./fixtures-data.ts";

type Method = "get" | "post" | "put" | "patch" | "delete";

/** Cliente HTTP da API autenticado como um papel (ou anônimo). */
export class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    private readonly role: RoleKey | null,
  ) {}

  static async as(role: RoleKey | null) {
    const ctx = await request.newContext({ baseURL: `${API_URL}/api/` });
    return new Api(ctx, role);
  }

  async call(method: Method, path: string, data?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.role) headers.Authorization = `Bearer ${await accessToken(this.role)}`;
    return this.ctx.fetch(path.replace(/^\//, ""), {
      method: method.toUpperCase(),
      headers,
      data,
      failOnStatusCode: false,
    });
  }

  get(path: string) { return this.call("get", path); }
  post(path: string, data?: unknown) { return this.call("post", path, data ?? {}); }
  put(path: string, data?: unknown) { return this.call("put", path, data ?? {}); }
  patch(path: string, data?: unknown) { return this.call("patch", path, data ?? {}); }
  delete(path: string, data?: unknown) { return this.call("delete", path, data); }

  async dispose() { await this.ctx.dispose(); }
}

export async function json<T = any>(response: APIResponse): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Resposta não é JSON (${response.status()}): ${text.slice(0, 300)}`);
  }
}

/** Mensagem curta para os expects: status + corpo. */
export async function describe(response: APIResponse) {
  return `${response.status()} ${response.url()} → ${(await response.text()).slice(0, 400)}`;
}
