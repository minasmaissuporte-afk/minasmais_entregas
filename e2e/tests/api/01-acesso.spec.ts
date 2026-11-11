import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import type { RoleKey } from "../../support/fixtures-data.ts";

type Role = "ADMIN" | "CENTRAL" | "STORE_MANAGER" | "STORE_STAFF" | "COURIER";
const roleOf: Record<RoleKey, Role | "PENDING"> = {
  admin: "ADMIN",
  central: "CENTRAL",
  manager: "STORE_MANAGER",
  staff: "STORE_STAFF",
  courier: "COURIER",
  pending: "PENDING",
};
const ALL: Role[] = ["ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF", "COURIER"];
const X = "e2e-inexistente";
// Mensagem do requireRole: separa "papel sem acesso" de 403 por regra de negócio (ex.: rota de outro motoboy).
const ROLE_DENIED = "Sua conta ainda não tem acesso a esta área.";

/** Todas as rotas protegidas da API com os papéis que podem usá-las (fonte: routes/*.ts). */
const endpoints: { method: "get" | "post" | "put" | "patch" | "delete"; path: string; roles: Role[] | "any" }[] = [
  { method: "get", path: "/me", roles: "any" },
  { method: "get", path: "/push/config", roles: "any" },
  { method: "post", path: "/push/subscription", roles: ["COURIER", "ADMIN", "CENTRAL"] },
  { method: "delete", path: "/push/subscription", roles: ["COURIER", "ADMIN", "CENTRAL"] },
  { method: "post", path: "/push/native-token", roles: ["COURIER", "ADMIN", "CENTRAL"] },
  { method: "delete", path: "/push/native-token", roles: ["COURIER", "ADMIN", "CENTRAL"] },
  { method: "get", path: "/dashboard/summary", roles: ["ADMIN", "CENTRAL"] },
  { method: "get", path: "/operations/active-routes", roles: ["ADMIN", "CENTRAL"] },
  { method: "get", path: "/reports/analytics", roles: ["ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"] },
  { method: "get", path: "/delivery-cancellation-reasons", roles: ["ADMIN", "CENTRAL", "COURIER"] },
  { method: "put", path: "/delivery-cancellation-reasons", roles: ["ADMIN", "CENTRAL"] },
  { method: "get", path: "/delivery-cancellations", roles: ["ADMIN", "CENTRAL"] },
  { method: "post", path: `/delivery-cancellations/${X}/action`, roles: ["ADMIN", "CENTRAL"] },
  { method: "get", path: "/deliveries", roles: ALL },
  { method: "post", path: "/deliveries", roles: ["ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"] },
  { method: "get", path: `/deliveries/${X}`, roles: ALL },
  { method: "delete", path: `/deliveries/${X}`, roles: ["ADMIN"] },
  { method: "post", path: `/deliveries/${X}/dispatch`, roles: ["ADMIN", "CENTRAL"] },
  { method: "patch", path: `/deliveries/${X}/status`, roles: ALL },
  { method: "post", path: `/deliveries/${X}/evidence/upload-url`, roles: ["COURIER"] },
  { method: "get", path: `/deliveries/${X}/evidence`, roles: ALL },
  { method: "get", path: "/stores", roles: ["ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"] },
  { method: "post", path: "/stores", roles: ["ADMIN"] },
  { method: "put", path: `/stores/${X}`, roles: ["ADMIN"] },
  { method: "delete", path: `/stores/${X}`, roles: ["ADMIN"] },
  { method: "get", path: "/enderecos/autocomplete", roles: ["ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"] },
  { method: "post", path: "/admin/demo-data/cleanup", roles: ["ADMIN"] },
  { method: "get", path: "/couriers", roles: ["ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"] },
  { method: "get", path: "/access/users", roles: ["ADMIN"] },
  { method: "patch", path: `/access/users/${X}`, roles: ["ADMIN"] },
  { method: "delete", path: `/access/users/${X}`, roles: ["ADMIN"] },
  { method: "get", path: "/courier/earnings", roles: ["COURIER"] },
  { method: "post", path: "/delivery-routes", roles: ["ADMIN", "CENTRAL"] },
  { method: "get", path: "/courier/routes", roles: ["COURIER"] },
  { method: "get", path: `/courier/routes/${X}/preview`, roles: ["COURIER"] },
  { method: "patch", path: "/courier/availability", roles: ["COURIER"] },
  { method: "post", path: `/courier/deliveries/${X}/decline`, roles: ["COURIER"] },
  { method: "post", path: `/courier/routes/${X}/decline`, roles: ["COURIER"] },
  { method: "post", path: "/courier/location", roles: ["COURIER"] },
  { method: "get", path: `/courier/deliveries/${X}/navigation`, roles: ["COURIER"] },
  { method: "post", path: `/courier/deliveries/${X}/unable`, roles: ["COURIER"] },
  { method: "post", path: `/courier/routes/${X}/accept`, roles: ["COURIER"] },
  { method: "post", path: `/courier/routes/${X}/stops/${X}/arrive`, roles: ["COURIER"] },
  { method: "post", path: `/courier/routes/${X}/stops/${X}/complete`, roles: ["COURIER"] },
];

test.describe("Rotas públicas", () => {
  test("GET /healthz responde ok sem login", async () => {
    const api = await Api.as(null);
    const res = await api.get("/healthz");
    expect(res.status()).toBe(200);
    expect(await json(res)).toEqual({ status: "ok" });
  });

  test("GET /push/vapid-public-key: chave válida, ou 503 explicado quando o VAPID não está configurado", async () => {
    const api = await Api.as(null);
    const res = await api.get("/push/vapid-public-key");
    const body = await json(res);
    if (process.env.VAPID_PUBLIC_KEY) {
      expect(res.status(), await describe(res)).toBe(200);
      expect(body.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    } else {
      expect(res.status(), await describe(res)).toBe(503);
      expect(body.error).toContain("VAPID");
    }
  });

  test("Rota inexistente: 401 sem login (não revela a API) e 404 logado", async () => {
    expect((await (await Api.as(null)).get("/nao-existe")).status()).toBe(401);
    expect((await (await Api.as("admin")).get("/nao-existe")).status()).toBe(404);
  });
});

test.describe("Sem login: todas as rotas protegidas devolvem 401", () => {
  for (const ep of endpoints) {
    test(`${ep.method.toUpperCase()} ${ep.path}`, async () => {
      const api = await Api.as(null);
      const res = await api.call(ep.method, ep.path, ep.method === "get" ? undefined : {});
      expect(res.status(), await describe(res)).toBe(401);
    });
  }

  test("Token inválido é tratado como não autenticado", async () => {
    const api = await Api.as(null);
    const res = await api.call("get", "/me", undefined, { Authorization: "Bearer token-falso" });
    expect(res.status(), await describe(res)).toBe(401);
  });
});

test.describe("Matriz de permissões: papel × rota", () => {
  for (const key of Object.keys(roleOf) as RoleKey[]) {
    const role = roleOf[key];
    test(`${role}: só acessa as rotas do seu papel`, async () => {
      const api = await Api.as(key);
      const problems: string[] = [];
      for (const ep of endpoints) {
        const allowed = ep.roles === "any" || (role !== "PENDING" && ep.roles.includes(role));
        const res = await api.call(ep.method, ep.path, ep.method === "get" ? undefined : {});
        const status = res.status();
        const text = await res.text();
        const label = `${ep.method.toUpperCase()} ${ep.path}`;
        if (status >= 500 && !(status === 503 && ep.path.startsWith("/push"))) {
          problems.push(`ERRO ${status} em ${label}: ${text.slice(0, 160)}`);
          continue;
        }
        const roleDenied = status === 403 && text.includes(ROLE_DENIED);
        if (!allowed && !roleDenied) problems.push(`deveria negar por papel ${label}, veio ${status}: ${text.slice(0, 120)}`);
        else if (allowed && (status === 401 || roleDenied)) {
          problems.push(`deveria permitir ${label}, veio ${status}: ${text.slice(0, 120)}`);
        }
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

test.describe("GET /me por papel", () => {
  for (const key of Object.keys(roleOf) as RoleKey[]) {
    test(`/me identifica ${roleOf[key]}`, async () => {
      const api = await Api.as(key);
      const res = await api.get("/me");
      expect(res.status(), await describe(res)).toBe(200);
      const me = await json(res);
      expect(me.role).toBe(roleOf[key]);
      expect(me.email).toMatch(/^e2e-.*@example\.com$/);
    });
  }
});
